struct Triangle {
    v0: vec3<f32>,
    materialIndex: u32,
    v1: vec3<f32>,
    emissivity: f32,
    v2: vec3<f32>,
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
}

@group(0) @binding(0) var<storage, read> triangles: array<Triangle>;
@group(0) @binding(1) var<storage, read> bvhNodes: array<BvhNode>;
@group(0) @binding(2) var<uniform> camera: Camera;
@group(0) @binding(3) var fb: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var<storage, read_write> accumBuffer: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> materials: array<Material>;
@group(0) @binding(6) var atlasTex: texture_2d<f32>;
@group(0) @binding(7) var atlasSamp: sampler;
@group(0) @binding(8) var<storage, read> lightIndices: array<u32>;

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
    
    if (tNear <= tFar && tFar > 0.0) {
        return tNear;
    }
    return 1e30;
}

fn intersectTriangle(ray: Ray, triIndex: u32) -> HitRecord {
    var rec: HitRecord;
    rec.t = -1.0;
    
    let tri = triangles[triIndex];
    let edge1 = tri.v1 - tri.v0;
    let edge2 = tri.v2 - tri.v0;
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

// PCG random number generator
fn rand_pcg(seed: ptr<function, u32>) -> f32 {
    let state = *seed;
    *seed = state * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return f32((word >> 22u) ^ word) / 4294967295.0;
}

fn randomHemisphereDir(normal: vec3<f32>, seed: ptr<function, u32>) -> vec3<f32> {
    let r1 = rand_pcg(seed);
    let r2 = rand_pcg(seed);
    
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

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) GlobalInvocationID: vec3<u32>) {
    let dimensions = textureDimensions(fb);
    if (GlobalInvocationID.x >= dimensions.x || GlobalInvocationID.y >= dimensions.y) {
        return;
    }
    let pixelCoords = vec2<i32>(GlobalInvocationID.xy);
    
    var seed = GlobalInvocationID.x + GlobalInvocationID.y * dimensions.x + camera.frameCounter * dimensions.x * dimensions.y;
    
    let jitter = vec2<f32>(rand_pcg(&seed) - 0.5, rand_pcg(&seed) - 0.5);
    let uv = (vec2<f32>(pixelCoords) + jitter) / vec2<f32>(dimensions) * 2.0 - 1.0;
    
    let aspect = f32(dimensions.x) / f32(dimensions.y);
    var ray: Ray;
    ray.origin = camera.pos;
    ray.dir = normalize(camera.dir + camera.right * uv.x * aspect - camera.up * uv.y);
    ray.invDir = 1.0 / ray.dir;
    
    var color = vec3<f32>(0.0);
    var throughput = vec3<f32>(1.0);
    
    for (var bounce = 0; bounce < 2; bounce += 1) {
        let rec = bvhIntersect(ray);
        
        if (rec.t < 1e29) {
            let hitPoint = ray.origin + ray.dir * rec.t;
            var normal = normalize(rec.normal);
            // If hitting a backface, flip the normal so we bounce out instead of getting stuck
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
                let lightIdxStr = min(u32(rand_pcg(&seed) * f32(camera.numLights)), camera.numLights - 1u);
                let lightTriIdx = lightIndices[lightIdxStr];
                let lightTri = triangles[lightTriIdx];
                
                // Pick a random point on the light triangle
                let r1 = rand_pcg(&seed);
                let r2 = rand_pcg(&seed);
                let sqrt_r1 = sqrt(r1);
                let u_light = 1.0 - sqrt_r1;
                let v_light = r2 * sqrt_r1;
                let w_light = 1.0 - u_light - v_light;
                
                let lightPoint = lightTri.v0 * u_light + lightTri.v1 * v_light + lightTri.v2 * w_light;
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
                    
                    let shadowRec = bvhIntersect(shadowRay);
                    // If we didn't hit anything closer than the light (allow small epsilon)
                    if (shadowRec.t >= lightDist - 0.01) {
                        let edge1 = lightTri.v1 - lightTri.v0;
                        let edge2 = lightTri.v2 - lightTri.v0;
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
            
            ray.origin = hitPoint + normal * 0.001;
            ray.dir = randomHemisphereDir(normal, &seed);
            ray.invDir = 1.0 / ray.dir;
            
            // Russian Roulette
            let p = max(throughput.r, max(throughput.g, throughput.b));
            if (bounce > 0) {
                if (rand_pcg(&seed) > p) {
                    break;
                }
                throughput /= p;
            }
        } else {
            color += throughput * vec3(0.5, 0.7, 1.0) * camera.skyLight;
            break;
        }
    }
    
    let pixelIndex = u32(pixelCoords.y) * dimensions.x + u32(pixelCoords.x);
    var accumColor = color;
    if (camera.frameCounter > 0u) {
        let oldColor = accumBuffer[pixelIndex].rgb;
        accumColor = oldColor + color;
    }
    accumBuffer[pixelIndex] = vec4<f32>(accumColor, 1.0);
    
    let finalColor = accumColor / f32(camera.frameCounter + 1u);
    let outColor = pow(finalColor, vec3<f32>(1.0 / 2.2));
    
    textureStore(fb, pixelCoords, vec4<f32>(outColor, 1.0));
}
