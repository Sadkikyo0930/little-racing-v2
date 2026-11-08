import puppeteer from 'puppeteer-core';
const launch=puppeteer.launch.bind(puppeteer);
puppeteer.launch=async (...args)=>{
  const browser=await launch(...args);
  const newPage=browser.newPage.bind(browser);
  browser.newPage=async (...pageArgs)=>{
    const page=await newPage(...pageArgs);
    const goto=page.goto.bind(page);
    page.goto=(url,opts)=>{
      const target=new URL(url);
      target.searchParams.set('quality','low');
      return goto(target.href,opts);
    };
    return page;
  };
  return browser;
};
process.argv=[process.argv[0], 'tools/test/reward.mjs', '--no-build'];
await import('./reward.mjs');
