import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
  
  await page.goto('http://localhost:5174/');
  
  // Wait for a few seconds to let WebGPU initialize and log errors
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  await browser.close();
})();
