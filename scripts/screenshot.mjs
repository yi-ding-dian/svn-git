/** 界面截图脚本：electron 离屏渲染 + capturePage（无需真实浏览器）
 * 用法: node_modules/.bin/electron scripts/screenshot.mjs '<JSON 任务数组>'
 * 任务: [{ url, out, wait?, click?, dblclick? }]
 */
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  // electron argv: [electron, --no-sandbox?, 脚本路径, JSON...]——取最后一个以 [ 开头的参数
  const jobsArg = process.argv.slice(2).find((a) => a.startsWith('[')) ?? '[]';
  const jobs = JSON.parse(jobsArg);
  if (jobs.length === 0) {
    console.error('用法: electron scripts/screenshot.mjs \'[{url,out,wait?,click?,dblclick?}]\'');
    app.exit(1);
    return;
  }
  await app.whenReady();
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: { offscreen: true },
  });

  for (const job of jobs) {
    try {
      await win.loadURL(job.url);
      await sleep(job.wait ?? 5000);
      if (job.click) {
        try {
          const ok = await win.webContents.executeJavaScript(job.click);
          console.log(`click: ${ok}`);
        } catch (e) {
          console.error(`click 执行失败: ${e.message}`);
        }
        await sleep(2500);
      }
      if (job.dblclick) {
        try {
          const ok = await win.webContents.executeJavaScript(job.dblclick);
          console.log(`dblclick: ${ok}`);
        } catch (e) {
          console.error(`dblclick 执行失败: ${e.message}`);
        }
        await sleep(2500);
      }
      const img = await win.webContents.capturePage();
      fs.writeFileSync(job.out, img.toPNG());
      console.log(`✅ saved: ${job.out}`);
    } catch (e) {
      console.error(`❌ ${job.out}: ${e.message}`);
    }
  }
  app.quit();
}

void run();
