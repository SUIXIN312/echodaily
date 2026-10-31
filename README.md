# EchoDaily · 回声英语

每天 25 分钟，用一条真实的国际新闻练英语听力。

- **今日页面**：原声视频 / 音频、双语逐句稿、点击任意句跳转、循环当前句、0.6–1.5 倍速。
- **每日任务**：盲听 3 分钟 → 精听 8 分钟 → 跟读 6 分钟 → 复述 5 分钟 → 复盘 3 分钟。
- **学习工具**：词汇卡与发音、3 道理解题、逐句“已掌握”标记、学习笔记、连续打卡、28 天热力图。
- **专注训练**：点“开始 25 分钟训练”，按步骤自动切换字幕、速度和播放位置，带计时器与录音回听。
- **本地优先**：所有记录只存在浏览器 `localStorage`，不上传服务器；支持 JSON 备份与恢复。

## 立即打开

### 公网链接（GitHub Pages）

**https://suixin312.github.io/echodaily/**

源码仓库：**https://github.com/SUIXIN312/echodaily**

### 电脑上

**http://127.0.0.1:8765/**

如果服务没有运行，双击 `启动 EchoDaily.cmd`。它会启动一个本地静态服务器并打开浏览器。

### 手机上（同一个 WiFi）

`127.0.0.1` 在手机上指的是手机自己，所以手机不能用它打开电脑上的服务。  
双击 `启动手机版 (同一WiFi).cmd`，然后在手机浏览器输入：

**http://172.18.201.215:8766/**

如果这个 IP 变了，在电脑上运行 `ipconfig`，找到 WLAN 的 IPv4 地址替换即可。手机和电脑必须在同一个 WiFi；如果一直转圈，允许 Python 通过 Windows 防火墙的“专用网络”。

想在任何网络下都能打开，需要把整个 `echo-daily` 文件夹部署到 GitHub Pages、Vercel、Netlify 这类静态托管服务，拿一个公网 URL。

### 完全不想开服务器：单文件版

`EchoDaily-单文件版.html` 把样式、脚本、5 期内容都打包进了一个 HTML 文件。把它发到手机（微信文件传输、网盘、AirDrop 都可以），用手机浏览器打开即可。

- 优点：不需要电脑开着，不需要同一个 WiFi，不需要安装任何东西。
- 限制：受手机浏览器对本地文件的限制，录音和 PWA 离线缓存可能不可用；视频/音频仍然需要联网加载。学习记录在部分浏览器里可能不会持久保存。

也可以手动启动：

```powershell
cd "D:\系统文件盘\文档\deepseek-harness\default-workspace\echo-daily"
python serve.py
```

如果系统没有 `python`，使用 DSH 自带的 Python：

```powershell
& "C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe" serve.py
```

> 不要直接双击 `index.html`。通过本地服务器打开，录音、PWA 缓存和本地数据会更稳定。

## 如何使用

1. 打开今日页面，先点 **先听为快**，不看字幕听一遍。
2. 点 **开始 25 分钟训练**，跟着 5 个步骤走。每一步都可以暂停计时。
3. 精听时点任意一句跳转；遇到听不清的句子，打开 **循环当前句**。
4. 跟读时把速度调到 **0.8×**，点“开始录音”录下自己的声音，再回听。
5. 完成后在右侧任务卡打勾，或直接让引导训练帮你完成 5 步。
6. 第二天回来，首页会自动显示下一期；也可以在 **听力库** 里回听旧内容。

## 内容说明

首版内置 2026 年 10 月 26–30 日的 5 期 CNN 10 精选片段。每期不是完整 10 分钟，而是围绕一个新闻主题剪出的 **2–4 分钟精听片段**，更适合反复听、跟读和复述。

- 视频 / 音频：CNN 10 原声，引用自公开节目页。
- 逐句稿：人工整理并与视频时间轴对齐；中文为学习用翻译。
- 版权归 CNN 所有，本应用仅作个人听力学习索引，不存储媒体文件，请勿商业分发。

想换体裁时，听力库底部还放了 NPR、TED、NASA 等公开来源入口。

## 添加新的一期

内容都在 `data.js` 的 `window.EPISODES` 数组里。新增一期时复制一个对象，至少需要：

```js
{
  id: "2026-11-02",
  date: "2026-11-02",
  availableFrom: "2026-11-03",
  dateLabel: "11月2日",
  title: "English headline",
  zhTitle: "中文标题",
  deck: "One-sentence English summary.",
  zhDeck: "一句中文导语。",
  source: "CNN 10",
  sourceUrl: "https://edition.cnn.com/audio/podcasts/cnn-10",
  transcriptUrl: "https://www.listeningexpress.com/cnn10/...",
  theme: "ember",              // ember | steel | forest | ocean | violet
  type: "news",                // news | tech
  format: "video",             // video | audio
  accent: "American",
  level: "B1–B2",
  duration: 180,               // 精听片段秒数
  fullDuration: 600,
  clipStart: 25.6,
  clipEnd: 205.6,
  media: { video: "https://...mp4", audio: "https://...mp3" },
  topics: ["World", "Politics"],
  summary: "English summary.",
  zhSummary: "中文摘要。",
  takeaways: ["...", "...", "..."],
  zhTakeaways: ["...", "...", "..."],
  segments: [
    { start: 25.6, end: 42.0, section: "01 · 标题", en: "English line", zh: "中文翻译" }
  ],
  vocab: [
    { word: "word", phonetic: "/wɜːrd/", pos: "n.", zh: "释义", example: "Example.", exampleZh: "例句翻译。" }
  ],
  questions: [
    { q: "Question?", options: ["A", "B", "C", "D"], answer: 1, explain: "Why." }
  ]
}
```

`availableFrom` 是它成为“今日内容”的日期。首页会选 `availableFrom <= 今天` 中日期最新的一期；超过日期也不会消失，会留在听力库。

## 文件结构

```text
echo-daily/
├─ index.html              页面骨架与图标
├─ data.js                 5 期双语内容（时间轴、词汇、题目）
├─ assets/
│  ├─ styles.css           全部样式与响应式布局
│  ├─ app.js               播放器、任务、专注训练、打卡、设置
│  └─ icon.svg             PWA 图标
├─ manifest.webmanifest    PWA 清单
├─ sw.js                   应用外壳离线缓存（不缓存媒体）
├─ serve.py                本地静态服务器
├─ 启动 EchoDaily.cmd      一键启动
├─ 每日听力计划.md          25 分钟训练法与 4 周进阶
└─ README.md
```

## 常见问题

**视频黑屏 / 加载慢？**
视频源在境外，首次加载可能需要几秒。播放器会自动回退到音频；也可以点右上角“音频”。字幕和逐句稿不受影响。

**录音没有反应？**
浏览器需要麦克风权限；`http://127.0.0.1` 属于安全上下文。若使用其他地址，需 HTTPS 或 localhost。

**换电脑会丢记录吗？**
会。记录只在本机浏览器。到“设置 → 导出 JSON”备份，在新设备导入即可。

**怎么让每天自动提醒？**
设置页可以下载 `.ics` 日历文件，导入系统日历后会每天同一时间提醒。这个工作区也配置了每天 07:30 的 DSH 提醒。
