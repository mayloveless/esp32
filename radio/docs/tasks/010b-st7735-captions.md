# Task 010B — ST7735 字幕 / Alien 译文

## 目标

在 010A 的状态、类型、中文标题基础上，把现有 Receiver manifest 的 captions 显示到实体机。

当前基线：218510a84c947e4bb26ad30d3e7440d9dd95f63e

现有 caption 结构：startMs / endMs / speaker / text。

- NEWS / CHAT：text 作为字幕。
- ALIEN：语音是伪外星语，但 caption text 保留中文语义，直接作为“译文”。
- MUSIC：不显示字幕。
- 不新增翻译 API，不调用 AI。

## 1. Device manifest

当前 ESP32 filter 没读取 captions。010B 需要加入 captions[].startMs、endMs、speaker、text；prefetch manifest 同样保留 captions。

解析后复制到设备自己的轻量 caption 结构，不依赖临时 JsonDocument 生命周期。设置明确上限，建议最多 24 条；单条 text 约 256 UTF-8 bytes、speaker 约 48 bytes，可根据 RAM 实测微调。超限安全截断，只记录计数，不把字幕正文打到 Serial。

## 2. 时间轴

字幕必须跟随真实音频位置，不要用 millis()-audioStartMillis 独立计时。

优先使用当前 ESP32-audioI2S 的 getAudioCurrentTime()，核对它在 setAudioPlayTime() seek 后的语义，再换算成 ms，与 startMs <= playbackMs < endMs 匹配。

从 startOffsetMs 中途接入时，首次 PLAYING 就直接显示当前位置附近的字幕，不显示已经播过的内容。

## 3. 更新频率

每 150–250ms 检查一次当前 caption 即可，但只有 caption 或当前显示页实际变化时才标 dirty。不能每次检查都刷新屏幕；ISR、audio callback、HTTP worker 都不画屏。

## 4. 长字幕分页

renderer 会合并相邻同 speaker 文本，所以 caption 可能很长。不要只截取前几行后几十秒不动。

按现有 wqy12 字体的 glyph width，把当前 caption 分成若干屏幕页，每页约 2–3 行。根据 caption 内播放进度选择页面：progress=(playbackMs-startMs)/(endMs-startMs)，pageIndex=floor(progress*pageCount)，并 clamp。

不要求逐字卡拉 OK，也不做滚动动画。

## 5. PLAYING 布局

播放状态给字幕让空间。建议顶部一行显示 kind + LOCKED，下面一行紧凑标题，再下面显示字幕区域。

NEWS / CHAT 显示“字幕”；ALIEN 显示“译文”；MUSIC 保持 010A 的无字幕界面。

CHAT 的 speaker 空间允许可显示，但不能挤掉主要字幕；过长安全截断。

## 6. 状态切换

TUNING、LOCKING、NO SIGNAL、SIGNAL LOST、NO NETWORK 都不得保留上一节目的字幕。开始新节目时先清当前 caption display state。

只有 NETWORK + seek 完成 + 已真正产生网络 PCM 后才开始推进字幕。

找不到 caption 只表示当前没有字幕，不允许因此判定播放失败。

## 7. 性能 / 内存

继续复用 u8g2_font_wqy12_t_gb2312，不引入新大字体。010A 当前 APP 约 76%，剩余约 749KB；frame buffer 运行时约 40KB。

caption 数据预算控制在几 KB 到十几 KB。提交时记录 APP、static RAM、caption 最大预算和真实节目典型 caption 数量。

010A 全帧 dirty redraw 约 18–24ms，第一版可以继续用；字幕/页面不变时绝不能重画。如果实测明显影响音频，再局部优化字幕区，不先重写显示驱动。

## 8. 必须保留

不得改变 completed / retire / replenish、startOffsetMs、HTTP WAV seek patch、单一 Audio owner、local static、encoder threshold、manifest prefetch、foreground tune、最近两条排除等现有行为。

## 9. 测试

至少覆盖：

1. start inclusive / end exclusive / caption 间空白。
2. seek 后直接匹配中途字幕。
3. 长 caption 多页与进度映射。
4. UTF-8 不拆中文，malformed / 超长文本安全。
5. 同 caption 同 page 不重复 dirty，换页才 dirty。
6. TUNING / LOCKING / ERROR 清字幕，新节目不残留旧字幕。
7. MUSIC 不显示字幕。
8. ALIEN 使用 caption text，标签为“译文”。

## 10. 真机验收

至少各测 1 条 NEWS/CHAT、ALIEN、MUSIC：

- NEWS/CHAT 出声后字幕出现；
- ALIEN 播伪外星语时显示中文译文；
- MUSIC 无空字幕框；
- startOffsetMs > 0 时字幕从实际位置开始；
- 长文本会随播放推进换页；
- caption 间静音不保留上一句；
- 转旋钮后旧字幕立即消失；
- 新节目不残留旧字幕；
- 字幕变化不高频闪屏；
- 音频没有因字幕明显恶化；
- completed / seek / static / prefetch 回归保持。

本任务不做：自动翻译、新 AI 请求、逐字高亮、卡拉 OK、进度条、动画、美术重做、网络播放延迟优化、网络音频断续专项修复。

完成后暂停。