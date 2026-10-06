# Task 009B — 本地调谐沙沙声与单一音频所有权

## 目标

在 Task 009A 已完成的实体旋钮调台基础上，加入真正的本地 tuning/static 声音。

当前体验：

```text
转旋钮
→ 当前节目立即停止
→ 静音等待
→ 新节目播放
```

目标体验：

```text
转旋钮
→ 当前节目立即停止
→ 立刻出现本地“沙沙 / 调谐”声
→ 持续转动时保持 tuning
→ 停稳约 300ms
→ 取得/消费 manifest
→ 停止 static
→ 网络节目接入
```

当前基线：

```text
68c5ed438b72badc50c7ffd279fde83abcfa3f5f
feat: add encoder retuning and manifest prefetch
```

不要开始 TFT。

---

## 一、最重要的约束：只有一个 I2S owner

不要创建第二个 `Audio` 实例。

不要同时让：

- tuning/static；
- network audio；

写 MAX98357A。

继续复用当前唯一的 `Audio networkAudio` 对象（是否重命名不是本任务重点）。

推荐模式：

```text
NONE
↓
NETWORK
↓ 用户旋转
NONE
↓
STATIC_LOCAL_FILE
↓ 锁台
NONE
↓
NETWORK
```

每次切换都必须先完全停止上一种音频并排空旧事件，再设置新的 owner。

---

## 二、本地 static 音频

使用当前 N16R8 的 FATFS 分区和 FFat。

不要从网络下载 static，不调用 AI，不依赖服务端。

启动时：

1. mount FFat；
2. 检查本地 tuning WAV；
3. 如果不存在或格式版本不匹配，则程序生成一份；
4. 后续调台直接 `connecttoFS()` 播放。

建议文件：

```text
/radio-tuning.wav
```

格式保持简单：

```text
32 kHz
mono
16-bit PCM WAV
```

内容用轻量伪随机算法生成“无线电沙沙声”即可，可以稍有高低起伏，但不要做复杂 DSP。

长度建议约 5–8 秒；如果 tuning 持续更久，允许本地循环播放。

不要把大 PCM 数组硬编码进源码。

---

## 三、音量必须保守

白噪声比语音主观上更刺耳。

static 不要按节目音量直接全幅播放。

要求：

- PCM 本身保持低幅度；
- static 播放时使用明显低于节目播放的 volume；
- 切回 network 时恢复现有节目 volume；
- 第一版宁可偏小，不要刺耳。

不要改变当前 MAX98357A 接线。

---

## 四、旋钮交互

第一次有效 encoder activity：

```text
停止当前 NETWORK
→ 不 completed
→ 清理旧网络播放状态
→ 启动 STATIC_LOCAL_FILE
→ receiverState = kTuning
```

继续旋转：

- 不重复重启 static；
- 只刷新 300ms settle 时间；
- 不重复请求 tune。

停稳 >= 300ms：

- 优先消费现有 manifest prefetch；
- 没有可用 prefetch 时走现有现场 tune；
- static 在 manifest 获取阶段尽量继续播放；
- 真正准备 `connecttohost(audioUrl)` 之前，再停止 static 并完成 owner handoff。

如果 tune 得到 `no_signal` 或请求失败：

- 停止 static；
- 回 idle；
- 不自动重试。

---

## 五、旧事件隔离

这是本任务最重要的正确性点之一。

NETWORK → STATIC 时：

1. stopSong；
2. 排空旧 network callback/event；
3. 清理 network EOF / error / samples / seek 状态；
4. 再把 owner 标成 STATIC；
5. 再启动本地 WAV。

STATIC → NETWORK 时同样：

1. stopSong；
2. 排空 static EOF/event；
3. 再清理状态；
4. owner 切 NETWORK；
5. connecttohost。

绝不能发生：

- 旧 network EOF 被当成 static EOF；
- static EOF 被当成节目自然完成；
- static 的 raw samples 让新 network 误判已经成功出声。

---

## 六、EOF 语义

根据当前 audio owner 区分。

### NETWORK EOF

保持现有逻辑：

```text
真实 EOF
→ completed
→ retire
→ replenish
```

### STATIC EOF

绝不能调用 completed。

如果仍处于 tuning：

```text
STATIC EOF
→ 重新播放 /radio-tuning.wav
```

如果已经准备切 network，则不要重新启动 static。

---

## 七、audio_process_raw_samples

现有 `audioProducedSamples` 是判断网络节目是否真正产生样本的重要保护。

static 的样本 **不能** 把它置 true。

只有：

```text
audioOwner == NETWORK
```

时，raw samples 才能参与当前网络播放成功判断。

保留 startOffsetMs、seek、stall、Wi-Fi/error 等现有防护。

---

## 八、Manifest Prefetch 必须保留

009A 已经加入非阻塞 manifest prefetch，用来降低物理换台等待。

不要删除、同步化或重写这个机制。

static 和 prefetch 应该协作：

```text
当前节目播放
→ 后台 prefetch manifest

用户旋转
→ static 立即响
→ 停稳
→ prefetch hit
→ 停 static
→ connect network audio
```

prefetch miss 时仍按现有现场 tune。

---

## 九、测试

补最小 host regression，至少覆盖：

1. NETWORK 播放中旋转：
   - network 停止；
   - 不 completed；
   - static 启动。

2. 连续旋转：
   - static 只启动一次；
   - 不反复重启。

3. static EOF + 仍在 tuning：
   - 本地 static 重播；
   - completed 仍为 0。

4. static → network：
   - static 先停止；
   - 旧事件排空；
   - 然后才连接网络音频。

5. static raw samples：
   - 不设置 network 的 `audioProducedSamples`。

6. network 自然 EOF：
   - 原 completed 行为不变。

7. no_signal / tune failure：
   - static 停止；
   - idle；
   - 不 completed。

8. prefetch hit：
   - 仍走原有快速路径；
   - static 正确 handoff。

不要为了测试建立大型抽象框架。

---

## 十、真机验收

至少验证：

1. 正在播节目时一转旋钮，原节目立即停；
2. 几乎立刻听到较轻的沙沙声；
3. 持续旋转时沙沙声不中途频繁重启；
4. 停稳后只 tune 一次；
5. 锁到节目时沙沙声停止，随后新节目播放；
6. 手动换走的节目没有 completed；
7. static EOF 永远不会 completed；
8. 新节目 startOffsetMs 仍正常；
9. 新节目自然播完仍 completed；
10. prefetch 仍正常工作。

重点观察切换过程中是否有明显爆音、极大音量或 I2S 冲突；出现任一种情况先停止，不用靠增加 delay 掩盖。

---

## 十一、本任务明确不做

- TFT；
- 旋钮按键；
- 音量旋钮；
- station/frequency slot；
- 真正模拟电台频率；
- 第二个 Audio 实例；
- 第二个并发 I2S owner；
- 网络 static；
- AI 生成 static；
- 自动下一台；
- 当前“网络节目声音断断续续”的专项优化。

完成后暂停，不开始 Task 010。
