import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  page.on('pageerror', err => {
    console.log('PAGE ERROR:', err.message);
  });
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('CONSOLE ERROR:', msg.text());
    }
  });

  try {
    await page.goto('http://localhost:5173');
    await new Promise(r => setTimeout(r, 1000));
    
    let text1 = await page.$eval('#btn-game-mode', el => el.textContent);
    console.log('Before click:', text1);

    await page.click('#btn-game-mode');
    await new Promise(r => setTimeout(r, 500));
    
    let text2 = await page.$eval('#btn-game-mode', el => el.textContent);
    console.log('After click:', text2);
    
  } catch (e) {
    console.log('ERROR:', e.message);
  }
  
  await browser.close();
})();
