struct Triangle {
    v0: vec3<f32>,
    materialIndex: u32,
    edge1: vec3<f32>,
    emissivity: f32,
    edge2: vec3<f32>,
    emissionExp: f32,
    normal: vec3<f32>,
    pad3: u32,
    uv0: vec2<f32>,
    uv1: vec2<f32>,
    uv2: vec2<f32>,
    pad4: vec2<f32>,
}

struct Material {
    u: f32,
    v: f32,
    w: f32,
    h: f32,
    width: f32,
    height: f32,
    pad1: f32,
    pad2: f32,
}

struct BvhNode {
    aabbMin: vec3<f32>,
    leftFirst: u32,
    aabbMax: vec3<f32>,
    triCount: u32,
}

struct Camera {
    pos: vec3<f32>,
    frameCounter: u32,
    dir: vec3<f32>,
    ambientLight: f32,
    right: vec3<f32>,
    skyLight: f32,
    up: vec3<f32>,
    numLights: u32,
    prevPos: vec3<f32>,
    aspect: f32,
    prevDir: vec3<f32>,
    framesStill: u32,
    prevRight: vec3<f32>,
    temporalBlend: f32,
    prevUp: vec3<f32>,
    fogDensity: f32,
    
    sunDir: vec3<f32>,
    volumetricsEnabled: u32,
    skyUV: vec4<f32>,
    maxBounces: u32,
    pad_end1: u32,
    pad_end2: u32,
    pad_end3: u32,
}

@group(0) @binding(0) var<storage, read> triangles: array<Triangle>;
@group(0) @binding(1) var<storage, read> bvhNodes: array<BvhNode>;
@group(0) @binding(2) var<uniform> camera: Camera;
@group(0) @binding(3) var historyTexWrite: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var historyTexRead: texture_2d<f32>;
@group(0) @binding(5) var<storage, read> materials: array<Material>;
@group(0) @binding(6) var atlasTex: texture_2d<f32>;
@group(0) @binding(7) var atlasSamp: sampler;
@group(0) @binding(8) var<storage, read> lightIndices: array<u32>;
@group(0) @binding(9) var historySamp: sampler;
@group(0) @binding(10) var<storage, read_write> splatBuffer: array<atomic<u32>>;

struct Ray {
    origin: vec3<f32>,
    dir: vec3<f32>,
    invDir: vec3<f32>,
}

struct HitRecord {
    t: f32,
    normal: vec3<f32>,
    triIndex: u32,
    u: f32,
    v: f32,
}

fn intersectAABB(ray: Ray, bvhNode: BvhNode) -> f32 {
    let t0 = (bvhNode.aabbMin - ray.origin) * ray.invDir;
    let t1 = (bvhNode.aabbMax - ray.origin) * ray.invDir;
    let tmin = min(t0, t1);
    let tmax = max(t0, t1);
    
    let tNear = max(max(tmin.x, tmin.y), tmin.z);
    let tFar = min(min(tmax.x, tmax.y), tmax.z);
    
    return select(1e30, tNear, tNear <= tFar && tFar > 0.0);
}

fn intersectTriangle(ray: Ray, triIndex: u32) -> HitRecord {
    var rec: HitRecord;
    rec.t = -1.0;
    
    let tri = triangles[triIndex];
    let edge1 = tri.edge1;
    let edge2 = tri.edge2;
    let h = cross(ray.dir, edge2);
    let a = dot(edge1, h);
    if (a > -0.0001 && a < 0.0001) {
        return rec;
    }
    
    let f = 1.0 / a;
    let s = ray.origin - tri.v0;
    let u = f * dot(s, h);
    if (u < 0.0 || u > 1.0) {
        return rec;
    }
    
    let q = cross(s, edge1);
    let v = f * dot(ray.dir, q);
    if (v < 0.0 || u + v > 1.0) {
        return rec;
    }
    
    let t = f * dot(edge2, q);
    if (t > 0.001) {
        rec.t = t;
        rec.normal = tri.normal;
        rec.triIndex = triIndex;
        rec.u = u;
        rec.v = v;
    }
    
    return rec;
}

fn bvhIntersect(ray: Ray) -> HitRecord {
    var rec: HitRecord;
    rec.t = 1e30;
    
    var stack: array<u32, 32>;
    var stackPtr: i32 = 0;
    stack[stackPtr] = 0u;
    stackPtr += 1;
    
    while (stackPtr > 0) {
        stackPtr -= 1;
        let nodeIdx = stack[stackPtr];
        let node = bvhNodes[nodeIdx];
        
        let tHit = intersectAABB(ray, node);
        if (tHit > rec.t) {
            continue;
        }
        
        if (node.triCount > 0u) {
            for (var i = 0u; i < node.triCount; i += 1u) {
                let triHit = intersectTriangle(ray, node.leftFirst + i);
                if (triHit.t > 0.0 && triHit.t < rec.t) {
                    // Check alpha!
                    let tri = triangles[triHit.triIndex];
                    let mat = materials[tri.materialIndex];
                    
                    if (mat.pad1 > 0.5) {
                        // Opaque material, no need to sample texture for alpha
                        rec = triHit;
                    } else {
                        let uv = (1.0 - triHit.u - triHit.v) * tri.uv0 + triHit.u * tri.uv1 + triHit.v * tri.uv2;
                        
                        let sampleU = mat.u + fract(uv.x / mat.width) * mat.w;
                        let sampleV = mat.v + fract(uv.y / mat.height) * mat.h;
                        
                        // In a compute shader we can't easily use textureSampleLevel if we don't have derivatives, 
                        // but we can use textureSampleLevel with level 0
                        let texColor = textureSampleLevel(atlasTex, atlasSamp, vec2<f32>(sampleU, sampleV), 0.0);
                        
                        if (texColor.a > 0.5) {
                            rec = triHit;
                        }
                    }
                }
            }
        } else {
            let leftChildIdx = node.leftFirst;
            let rightChildIdx = leftChildIdx + 1u;
            
            let tLeft = intersectAABB(ray, bvhNodes[leftChildIdx]);
            let tRight = intersectAABB(ray, bvhNodes[rightChildIdx]);
            
            if (tLeft < tRight) {
                if (tRight < rec.t) { stack[stackPtr] = rightChildIdx; stackPtr += 1; }
                if (tLeft < rec.t) { stack[stackPtr] = leftChildIdx; stackPtr += 1; }
            } else {
                if (tLeft < rec.t) { stack[stackPtr] = leftChildIdx; stackPtr += 1; }
                if (tRight < rec.t) { stack[stackPtr] = rightChildIdx; stackPtr += 1; }
            }
        }
    }
    return rec;
}

fn bvhIntersectShadow(ray: Ray, maxDist: f32) -> bool {
    var stack: array<u32, 32>;
    var stackPtr = 0u;
    stack[stackPtr] = 0u;
    stackPtr += 1u;
    
    while (stackPtr > 0u) {
        stackPtr -= 1u;
        let nodeIdx = stack[stackPtr];
        let node = bvhNodes[nodeIdx];
        
        let nodeDist = intersectAABB(ray, node);
        if (nodeDist > maxDist) {
            continue;
        }
        
        if (node.triCount > 0u) {
            for (var i = 0u; i < node.triCount; i += 1u) {
                let triHit = intersectTriangle(ray, node.leftFirst + i);
                if (triHit.t > 0.001 && triHit.t < maxDist) {
                    let tri = triangles[triHit.triIndex];
                    let mat = materials[tri.materialIndex];
                    
                    if (mat.pad1 > 0.5) {
                        return true;
                    } else {
                        let uv = (1.0 - triHit.u - triHit.v) * tri.uv0 + triHit.u * tri.uv1 + triHit.v * tri.uv2;
                        let sampleU = mat.u + fract(uv.x / mat.width) * mat.w;
                        let sampleV = mat.v + fract(uv.y / mat.height) * mat.h;
                        let texColor = textureSampleLevel(atlasTex, atlasSamp, vec2<f32>(sampleU, sampleV), 0.0);
                        if (texColor.a > 0.5) {
                            return true;
                        }
                    }
                }
            }
        } else {
            let leftChildIdx = node.leftFirst;
            let rightChildIdx = leftChildIdx + 1u;
            
            let tLeft = intersectAABB(ray, bvhNodes[leftChildIdx]);
            let tRight = intersectAABB(ray, bvhNodes[rightChildIdx]);
            
            if (tLeft < tRight) {
                if (tRight < maxDist) { stack[stackPtr] = rightChildIdx; stackPtr += 1u; }
                if (tLeft < maxDist) { stack[stackPtr] = leftChildIdx; stackPtr += 1u; }
            } else {
                if (tLeft < maxDist) { stack[stackPtr] = leftChildIdx; stackPtr += 1u; }
                if (tRight < maxDist) { stack[stackPtr] = rightChildIdx; stackPtr += 1u; }
            }
        }
    }
    return false;
}

// XorShift32 random number generator (ultra-fast)
fn rand_xorshift(seed: ptr<function, u32>) -> f32 {
    var x = *seed;
    x ^= x << 13u;
    x ^= x >> 17u;
    x ^= x << 5u;
    *seed = x;
    return f32(x) * 2.3283064365386963e-10; // 1 / 4294967296.0
}

fn randomHemisphereDir(normal: vec3<f32>, seed: ptr<function, u32>) -> vec3<f32> {
    let r1 = rand_xorshift(seed);
    let r2 = rand_xorshift(seed);
    
    let phi = 2.0 * 3.1415926535 * r1;
    let r = sqrt(r2);
    let x = r * cos(phi);
    let y = r * sin(phi);
    let z = sqrt(max(0.0, 1.0 - r2));
    
    let w = normal;
    // If w is mostly pointing along X, use Y axis as arbitrary up, else use X axis
    let a = select(vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0), abs(w.x) > 0.9);
    let u = normalize(cross(a, w));
    let v = cross(w, u);
    
    return u * x + v * y + w * z;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) GlobalInvocationID: vec3<u32>) {
    let dimensions = textureDimensions(historyTexWrite);
    if (GlobalInvocationID.x >= dimensions.x || GlobalInvocationID.y >= dimensions.y) {
        return;
    }
    let pixelCoords = vec2<i32>(GlobalInvocationID.xy);
    
    var seed = u32(GlobalInvocationID.x * 1973u + GlobalInvocationID.y * 9277u + camera.frameCounter * 26699u) | 1u;
    let jitterX = rand_xorshift(&seed) - 0.5;
    let jitterY = rand_xorshift(&seed) - 0.5;
    let jitter = vec2<f32>(jitterX, jitterY);
    let pixelCenter = vec2<f32>(pixelCoords) + vec2<f32>(0.5, 0.5);
    let uv = (pixelCenter + jitter) / vec2<f32>(dimensions) * 2.0 - 1.0;
    
    let aspect = f32(dimensions.x) / f32(dimensions.y);
    var ray: Ray;
    ray.origin = camera.pos;
    ray.dir = normalize(camera.dir + camera.right * uv.x * aspect - camera.up * uv.y);
    ray.invDir = 1.0 / ray.dir;
    
    var color = vec3<f32>(0.0);
    var throughput = vec3<f32>(1.0);
    var firstHitT = 1e30;
    
    for (var bounce = 0; bounce < i32(camera.maxBounces); bounce += 1) {
        let rec = bvhIntersect(ray);
        
        if (bounce == 0) {
            firstHitT = rec.t;
        }
        
        // Volumetric Scattering
        var hitDist = rec.t;
        var scatteredInFog = false;
        
        if (camera.volumetricsEnabled == 1u) {
            let scatterDist = -log(max(0.0001, rand_xorshift(&seed))) / camera.fogDensity;
            if (scatterDist < rec.t) {
                hitDist = scatterDist;
                scatteredInFog = true;
            } else if (rec.t < 1e29) {
                // Ray hit surface, reduce throughput by fog transmittance
                throughput *= exp(-camera.fogDensity * rec.t);
            }
        }
        
        if (hitDist < 1e29) {
            let hitPoint = ray.origin + ray.dir * hitDist;
            
            if (scatteredInFog) {
                let normal = randomHemisphereDir(-ray.dir, &seed); // Isotropic Phase Function
                
                // Volumetric NEE (Next Event Estimation)
                if (camera.numLights > 0u) {
                    let lightIdxStr = min(u32(rand_xorshift(&seed) * f32(camera.numLights)), camera.numLights - 1u);
                    let lightTriIdx = lightIndices[lightIdxStr];
                    let lightTri = triangles[lightTriIdx];
                    
                    let r1 = rand_xorshift(&seed);
                    let r2 = rand_xorshift(&seed);
                    let sqrt_r1 = sqrt(r1);
                    let u_light = 1.0 - sqrt_r1;
                    let v_light = r2 * sqrt_r1;
                    let w_light = 1.0 - u_light - v_light;
                    
                    let lightPoint = lightTri.v0 + lightTri.edge1 * v_light + lightTri.edge2 * w_light;
                    let lightDirUnnorm = lightPoint - hitPoint;
                    let lightDist = length(lightDirUnnorm);
                    let lightDir = lightDirUnnorm / lightDist;
                    
                    let cosLight = dot(lightTri.normal, -lightDir);
                    
                    if (cosLight > 0.0) {
                        var shadowRay: Ray;
                        shadowRay.origin = hitPoint;
                        shadowRay.dir = lightDir;
                        shadowRay.invDir = 1.0 / lightDir;
                        
                        if (!bvhIntersectShadow(shadowRay, lightDist - 0.01)) {
                            let edge1 = lightTri.edge1;
                            let edge2 = lightTri.edge2;
                            let lightArea = length(cross(edge1, edge2)) * 0.5;
                            
                            let solidAngle = (lightArea * cosLight) / (lightDist * lightDist);
                            
                            var lightEmissionMultiplier = 1.0;
                            if (lightTri.emissionExp > 0.0) {
                                lightEmissionMultiplier = pow(cosLight, lightTri.emissionExp) * (lightTri.emissionExp + 1.0);
                            }
                            
                            let lightMat = materials[lightTri.materialIndex];
                            let lightUV = (1.0 - u_light - v_light) * lightTri.uv0 + u_light * lightTri.uv1 + v_light * lightTri.uv2;
                            let lSampleU = lightMat.u + fract(lightUV.x / lightMat.width) * lightMat.w;
                            let lSampleV = lightMat.v + fract(lightUV.y / lightMat.height) * lightMat.h;
                            let lTexColor = textureSampleLevel(atlasTex, atlasSamp, vec2<f32>(lSampleU, lSampleV), 0.0).rgb;
                            
                            let lightRadiance = lTexColor * lightTri.emissivity * lightEmissionMultiplier;
                            
                            // Phase function is 1/(4pi) for isotropic scattering
                            let phaseFunction = 1.0 / (4.0 * 3.14159);
                            let transmittance = exp(-camera.fogDensity * lightDist);
                            
                            color += throughput * lightRadiance * phaseFunction * transmittance * (solidAngle / 3.14159) * f32(camera.numLights);
                        }
                    }
                }
                
                // Volumetric Sun NEE
                var sunRay: Ray;
                sunRay.origin = hitPoint;
                sunRay.dir = camera.sunDir;
                sunRay.invDir = 1.0 / camera.sunDir;
                if (!bvhIntersectShadow(sunRay, 1e28)) {
                    let sunRadiance = vec3(1.0, 0.9, 0.8) * camera.skyLight * 5.0;
                    let phaseFunction = 1.0 / (4.0 * 3.14159);
                    var sunTransmittance = 1.0;
                    if (camera.volumetricsEnabled == 1u) {
                        sunTransmittance = exp(-camera.fogDensity * 50.0);
                    }
                    color += throughput * sunRadiance * phaseFunction * sunTransmittance;
                }
                
                ray.origin = hitPoint;
                ray.dir = normal;
                ray.invDir = 1.0 / ray.dir;
                
                // No color absorption, pure scattering
            } else {
                var normal = normalize(rec.normal);
                if (dot(normal, ray.dir) > 0.0) {
                    normal = -normal;
                }
            
            let tri = triangles[rec.triIndex];
            let mat = materials[tri.materialIndex];
            
            // Re-calculate UV to sample color
            let triUV = (1.0 - rec.u - rec.v) * tri.uv0 + rec.u * tri.uv1 + rec.v * tri.uv2;
            let sampleU = mat.u + fract(triUV.x / mat.width) * mat.w;
            let sampleV = mat.v + fract(triUV.y / mat.height) * mat.h;
            
            let texColor = textureSampleLevel(atlasTex, atlasSamp, vec2<f32>(sampleU, sampleV), 0.0).rgb;
            
            var emissionMultiplier = 1.0;
            if (tri.emissionExp > 0.0) {
                let cosTheta = max(0.0001, dot(normal, -ray.dir));
                emissionMultiplier = pow(cosTheta, tri.emissionExp) * (tri.emissionExp + 1.0);
            }
            
            let emission = texColor * tri.emissivity * emissionMultiplier;
            let ambient = texColor * camera.ambientLight;
            color += throughput * (emission + ambient);
            
            // Pure Lambertian diffuse reflection
            // Cosine term is implicitly handled by cosine-weighted hemisphere sampling
            
            // Next Event Estimation (Explicit Light Sampling)
            if (camera.numLights > 0u) {
                // Pick a random light
                let lightIdxStr = min(u32(rand_xorshift(&seed) * f32(camera.numLights)), camera.numLights - 1u);
                let lightTriIdx = lightIndices[lightIdxStr];
                let lightTri = triangles[lightTriIdx];
                
                // Pick a random point on the light triangle
                let r1 = rand_xorshift(&seed);
                let r2 = rand_xorshift(&seed);
                let sqrt_r1 = sqrt(r1);
                let u_light = 1.0 - sqrt_r1;
                let v_light = r2 * sqrt_r1;
                let w_light = 1.0 - u_light - v_light;
                
                let lightPoint = lightTri.v0 + lightTri.edge1 * v_light + lightTri.edge2 * w_light;
                let lightDirUnnorm = lightPoint - hitPoint;
                let lightDist = length(lightDirUnnorm);
                let lightDir = lightDirUnnorm / lightDist;
                
                let cosLight = dot(lightTri.normal, -lightDir);
                let cosSurface = dot(normal, lightDir);
                
                if (cosLight > 0.0 && cosSurface > 0.0) {
                    // Trace shadow ray
                    var shadowRay: Ray;
                    shadowRay.origin = hitPoint + normal * 0.001;
                    shadowRay.dir = lightDir;
                    shadowRay.invDir = 1.0 / lightDir;
                    
                    if (!bvhIntersectShadow(shadowRay, lightDist - 0.01)) {
                        let edge1 = lightTri.edge1;
                        let edge2 = lightTri.edge2;
                        let lightArea = length(cross(edge1, edge2)) * 0.5;
                        
                        // Solid angle = area * cos(theta) / r^2
                        let solidAngle = (lightArea * cosLight) / (lightDist * lightDist);
                        
                        var lightEmissionMultiplier = 1.0;
                        if (lightTri.emissionExp > 0.0) {
                            lightEmissionMultiplier = pow(cosLight, lightTri.emissionExp) * (lightTri.emissionExp + 1.0);
                        }
                        
                        let lightMat = materials[lightTri.materialIndex];
                        let lightUV = (1.0 - u_light - v_light) * lightTri.uv0 + u_light * lightTri.uv1 + v_light * lightTri.uv2;
                        let lSampleU = lightMat.u + fract(lightUV.x / lightMat.width) * lightMat.w;
                        let lSampleV = lightMat.v + fract(lightUV.y / lightMat.height) * lightMat.h;
                        let lTexColor = textureSampleLevel(atlasTex, atlasSamp, vec2<f32>(lSampleU, lSampleV), 0.0).rgb;
                        
                        let lightRadiance = lTexColor * lightTri.emissivity * lightEmissionMultiplier;
                        
                        // Add NEE contribution. (throughput * texColor is our surface BRDF factor here)
                        color += throughput * texColor * lightRadiance * (solidAngle / 3.14159) * f32(camera.numLights);
                    }
                }
            }
            
            throughput *= texColor;
            
            // Surface Sun NEE
            let sunCos = dot(normal, camera.sunDir);
            if (sunCos > 0.0) {
                var sunRay: Ray;
                sunRay.origin = hitPoint + normal * 0.001;
                sunRay.dir = camera.sunDir;
                sunRay.invDir = 1.0 / camera.sunDir;
                if (!bvhIntersectShadow(sunRay, 1e28)) {
                    let sunRadiance = vec3(1.0, 0.9, 0.8) * camera.skyLight * 5.0;
                    var sunTransmittance = 1.0;
                    if (camera.volumetricsEnabled == 1u) {
                        sunTransmittance = exp(-camera.fogDensity * 50.0);
                    }
                    color += throughput * sunRadiance * (sunCos / 3.14159) * sunTransmittance;
                }
            }
            
            ray.origin = hitPoint + normal * 0.001;
            ray.dir = randomHemisphereDir(normal, &seed);
            ray.invDir = 1.0 / ray.dir;
            } // End of Surface Hit
            
            // Russian Roulette
            let p = max(throughput.r, max(throughput.g, throughput.b));
            if (bounce > 0) {
                if (p < 0.001 || rand_xorshift(&seed) > p) {
                    break;
                }
                throughput /= p;
            }
        } else {
            // Hit the sky
            let skyU = atan2(-ray.dir.z, ray.dir.x) / (2.0 * 3.14159) + 0.5;
            let skyV = acos(ray.dir.y) / 3.14159;
            
            // Map vertically (DOOM sky texture is usually repeated 4 times horizontally, but we just wrap cylindrical)
            let finalSkyU = fract(skyU * 4.0);
            // Limit vertical to just upper hemisphere (0 to 0.5 in acos mapping)
            let finalSkyV = clamp((skyV - 0.2) * 2.0, 0.0, 1.0);
            
            let sampleU = camera.skyUV.x + finalSkyU * camera.skyUV.z;
            let sampleV = camera.skyUV.y + finalSkyV * camera.skyUV.w;
            let skyTex = textureSampleLevel(atlasTex, atlasSamp, vec2<f32>(sampleU, sampleV), 0.0).rgb;
            
            // Darken the sky map so it's not overpowering
            var finalSkyColor = skyTex * 0.4;
            
            // Draw the sun disk on top of the sky texture
            let sunDot = dot(ray.dir, camera.sunDir);
            if (sunDot > 0.999) {
                // The sun brightness is controlled by skyLight
                finalSkyColor += vec3(1.0, 0.9, 0.8) * camera.skyLight * 5.0;
            }
            
            color += throughput * finalSkyColor;
            break;
        }
    }
    
    // Read light trace contribution from splat buffer
    let pixIdx = u32(pixelCoords.y) * dimensions.x + u32(pixelCoords.x);
    let ltR = f32(atomicLoad(&splatBuffer[pixIdx * 3u])) / 4096.0;
    let ltG = f32(atomicLoad(&splatBuffer[pixIdx * 3u + 1u])) / 4096.0;
    let ltB = f32(atomicLoad(&splatBuffer[pixIdx * 3u + 2u])) / 4096.0;
    color += vec3(ltR, ltG, ltB);
    
    let isMoving = distance(camera.pos, camera.prevPos) > 0.001 || distance(camera.dir, camera.prevDir) > 0.001;
    
    // Reprojection
    var historyColor = vec3<f32>(0.0);
    var validHistory = false;
    
    if (!isMoving) {
        historyColor = textureLoad(historyTexRead, pixelCoords, 0).rgb;
        validHistory = true;
    } else {
        // Calculate world-space position of the first hit (or far plane for sky)
        var worldPos = ray.origin + ray.dir * 1000.0;
        if (firstHitT < 1e29) {
            worldPos = camera.pos + ray.dir * firstHitT;
        }
        
        // Project into previous frame
        let wPrev = worldPos - camera.prevPos;
        let tPrev = dot(wPrev, camera.prevDir);
        if (tPrev > 0.1) {
            let xPrev = dot(wPrev, camera.prevRight) / (camera.aspect * tPrev);
            let yPrev = dot(wPrev, camera.prevUp) / tPrev;
            
            if (xPrev >= -1.0 && xPrev <= 1.0 && yPrev >= -1.0 && yPrev <= 1.0) {
                let prevUV = vec2<f32>(xPrev, -yPrev) * 0.5 + 0.5;
                historyColor = textureSampleLevel(historyTexRead, historySamp, prevUV, 0.0).rgb;
                validHistory = true;
            }
        }
    }
    
    var blendWeight = 1.0 / f32(camera.framesStill + 1u); 
    if (isMoving) {
        blendWeight = camera.temporalBlend; 
    }
    
    // Ensure the user's "temporal smear" setting is respected even when standing still!
    // If they set smear to 0 (temporalBlend = 1.0), this forces blendWeight to 1.0 (no history).
    blendWeight = max(blendWeight, camera.temporalBlend);

    if (camera.frameCounter == 0u || !validHistory) {
        blendWeight = 1.0;
    }
    
    var accumColor = mix(historyColor, color, blendWeight);
    
    // Prevent NaNs
    if (any(accumColor != accumColor)) { accumColor = vec3(0.0); }
    
    textureStore(historyTexWrite, pixelCoords, vec4<f32>(accumColor, 1.0));
}

// ============================================================
// Light Tracing Pass — traces rays FROM lights TO the camera
// ============================================================
@compute @workgroup_size(8, 8)
fn lightTrace(@builtin(global_invocation_id) gid: vec3<u32>) {
    let dimensions = textureDimensions(historyTexWrite);
    if (gid.x >= dimensions.x || gid.y >= dimensions.y) {
        return;
    }
    if (camera.numLights == 0u) {
        return;
    }
    
    var seed = u32(gid.x * 6971u + gid.y * 31337u + camera.frameCounter * 48611u) | 1u;
    
    // 1. Pick a random light triangle
    let lightIdx = min(u32(rand_xorshift(&seed) * f32(camera.numLights)), camera.numLights - 1u);
    let lightTriIdx = lightIndices[lightIdx];
    let lightTri = triangles[lightTriIdx];
    
    // 2. Pick a random point on the light
    let r1 = rand_xorshift(&seed);
    let r2 = rand_xorshift(&seed);
    let sqrt_r1 = sqrt(r1);
    let u_l = 1.0 - sqrt_r1;
    let v_l = r2 * sqrt_r1;
    
    let lightOrigin = lightTri.v0 + lightTri.edge1 * u_l + lightTri.edge2 * v_l;
    let lightNormal = lightTri.normal;
    
    // 3. Compute light emission radiance
    let lightMat = materials[lightTri.materialIndex];
    let lightUV = (1.0 - u_l - v_l) * lightTri.uv0 + u_l * lightTri.uv1 + v_l * lightTri.uv2;
    let lSU = lightMat.u + fract(lightUV.x / lightMat.width) * lightMat.w;
    let lSV = lightMat.v + fract(lightUV.y / lightMat.height) * lightMat.h;
    let lightTexColor = textureSampleLevel(atlasTex, atlasSamp, vec2<f32>(lSU, lSV), 0.0).rgb;
    let lightArea = length(cross(lightTri.edge1, lightTri.edge2)) * 0.5;
    var lightRadiance = lightTexColor * lightTri.emissivity * f32(camera.numLights);
    
    // 4. Emit ray in cosine-weighted hemisphere from light surface
    let emitDir = randomHemisphereDir(lightNormal, &seed);
    var ray: Ray;
    ray.origin = lightOrigin + lightNormal * 0.01;
    ray.dir = emitDir;
    ray.invDir = 1.0 / ray.dir;
    
    // Carry the full emitted power: radiance * area * pi (Lambertian emitter)
    // Divided by PDF of choosing this light (1/numLights) and point on light (1/area)
    // and cosine-weighted hemisphere PDF (cos/pi), giving: radiance * pi * cos_emit
    // But cosine-weighted sampling already includes cos/pi, so throughput = radiance * area * pi
    var throughput = lightRadiance * lightArea * 3.14159;
    
    // 5. Trace into scene (1 bounce)
    let rec = bvhIntersect(ray);
    if (rec.t >= 1e29) {
        return; // Missed everything
    }
    
    let hitPoint = ray.origin + ray.dir * rec.t;
    var hitNormal = normalize(rec.normal);
    if (dot(hitNormal, ray.dir) > 0.0) {
        hitNormal = -hitNormal;
    }
    
    // Get surface albedo at hit point
    let hitTri = triangles[rec.triIndex];
    let hitMat = materials[hitTri.materialIndex];
    let hitUV = (1.0 - rec.u - rec.v) * hitTri.uv0 + rec.u * hitTri.uv1 + rec.v * hitTri.uv2;
    let hSU = hitMat.u + fract(hitUV.x / hitMat.width) * hitMat.w;
    let hSV = hitMat.v + fract(hitUV.y / hitMat.height) * hitMat.h;
    let surfaceAlbedo = textureSampleLevel(atlasTex, atlasSamp, vec2<f32>(hSU, hSV), 0.0).rgb;
    
    // Apply Lambertian BRDF: albedo / pi
    throughput *= surfaceAlbedo / 3.14159;
    
    // 6. Project hit point into camera screen space
    let toHit = hitPoint - camera.pos;
    let camDist = dot(toHit, camera.dir);
    if (camDist < 0.1) {
        return; // Behind camera
    }
    
    let screenX = dot(toHit, camera.right) / (camera.aspect * camDist);
    let screenY = dot(toHit, camera.up) / camDist;
    
    if (screenX < -1.0 || screenX > 1.0 || screenY < -1.0 || screenY > 1.0) {
        return; // Off screen
    }
    
    // 7. Shadow test from hit point back to camera
    let toCam = camera.pos - hitPoint;
    let toCamDist = length(toCam);
    let toCamDir = toCam / toCamDist;
    
    let cosSurface = dot(hitNormal, toCamDir);
    if (cosSurface <= 0.0) {
        return; // Surface facing away from camera
    }
    
    var shadowRay: Ray;
    shadowRay.origin = hitPoint + hitNormal * 0.01;
    shadowRay.dir = toCamDir;
    shadowRay.invDir = 1.0 / toCamDir;
    
    if (bvhIntersectShadow(shadowRay, toCamDist - 0.1)) {
        return; // Occluded
    }
    
    // 8. Compute final contribution
    // Geometry term: cos(surface->camera) / distance^2
    let geometryTerm = cosSurface / (toCamDist * toCamDist);
    let contribution = throughput * geometryTerm;
    
    // Normalize: each thread fires 1 photon. Scale to match camera-side radiance.
    let scaledContrib = contribution * 0.5;
    
    // 9. Convert screen coords to pixel coords and splat
    let pixX = u32(clamp((screenX * 0.5 + 0.5) * f32(dimensions.x), 0.0, f32(dimensions.x - 1u)));
    let pixY = u32(clamp((-screenY * 0.5 + 0.5) * f32(dimensions.y), 0.0, f32(dimensions.y - 1u)));
    let pixIdx = pixY * dimensions.x + pixX;
    
    // Encode as fixed-point and atomicAdd
    let rVal = u32(clamp(scaledContrib.r * 4096.0, 0.0, 16777215.0));
    let gVal = u32(clamp(scaledContrib.g * 4096.0, 0.0, 16777215.0));
    let bVal = u32(clamp(scaledContrib.b * 4096.0, 0.0, 16777215.0));
    
    atomicAdd(&splatBuffer[pixIdx * 3u], rVal);
    atomicAdd(&splatBuffer[pixIdx * 3u + 1u], gVal);
    atomicAdd(&splatBuffer[pixIdx * 3u + 2u], bVal);
}
