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
    
    console.log('Clicking Play...');
    await page.click('#btn-play');
    await new Promise(r => setTimeout(r, 1000));
    
    console.log('Pressing Escape...');
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 1000));
    
    console.log('Clicking Save & Quit...');
    // wait for pause menu to be visible (just to be sure, we trigger the click via eval)
    await page.evaluate(() => {
      document.exitPointerLock();
      document.getElementById('btn-quit').click();
    });
    await new Promise(r => setTimeout(r, 1000));
    
    console.log('Clicking Game Mode...');
    await page.click('#btn-game-mode');
    await new Promise(r => setTimeout(r, 1000));
    
    console.log('Done.');
  } catch (e) {
    console.log('ERROR:', e.message);
  }
  
  await browser.close();
})();
