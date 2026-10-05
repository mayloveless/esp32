# ESP32-audioI2S 4.0.0 HTTP WAV seek 修复

针对诊断确认的失败：首次 `Range: bytes=0-` 返回有效 206 / Content-Range，却没有 Accept-Ranges，库未设置支持标志；后续 seek 返回 -1 后仍读取旧连接。

本补丁在已有诊断补丁上修复库本身，继续使用原生 HTTP Range、WAV 解码和单个 I2S owner，没有代理、整文件下载或 sketch 自行构造的 Range。

- 首次 206 必须有合法的完整字节范围、从 0 开始，且响应体长度一致，才建立 Range 支持标志。
- 后续 seek 必须返回 206，范围起点、终点、文件总长及已提供的 Content-Length 必须匹配原生请求；拒绝 200、缺失或错误范围、错误状态及不支持的 chunked 片段，避免从错误位置继续。
- 解析 Range 响应后恢复完整文件长度，Content-Length 不再将其改成剩余片段长度。
- audioFileSeek 的失败统一返回 -1；newInBuffStart 在返回位置不匹配时立即停止，不清空缓冲后继续读取旧连接。位置 0 仍是合法的成功值。
- HTTP WAV seek 只预填两个解码块（8 KiB），保留原生 3 秒超时与后续流式读取；其他格式的原生预填量不变。
- `audio seek queued` 表示 API 接受请求；只有原生重填和对齐成功才打印 `audio seek applied: position=N`。

## 安装与回退

`library-hashes.json` 记录诊断版和修复版源文件的 SHA-256。只对匹配指纹的已安装 4.0.0 应用。补丁依赖 `diagnostics/esp32-audioI2S-4.0.0-seek.patch`；若库仍为原版，先按 diagnostics/README.md 应用诊断补丁。已修复的库不要重复应用。

在仓库根目录，对诊断版先检查再应用：

```bash
RADIO_AUDIO_LIBRARY_DIR='/Users/liuxiaoyu/Documents/Arduino/libraries/ESP32-audioI2S-master'
patch --dry-run -p1 -d "$RADIO_AUDIO_LIBRARY_DIR" < radio-device/patches/esp32-audioI2S-4.0.0-http-seek.patch
patch -p1 -d "$RADIO_AUDIO_LIBRARY_DIR" < radio-device/patches/esp32-audioI2S-4.0.0-http-seek.patch
```

回退至诊断版：

```bash
patch --dry-run -R -p1 -d "$RADIO_AUDIO_LIBRARY_DIR" < radio-device/patches/esp32-audioI2S-4.0.0-http-seek.patch
patch -R -p1 -d "$RADIO_AUDIO_LIBRARY_DIR" < radio-device/patches/esp32-audioI2S-4.0.0-http-seek.patch
```

每次修改库后重新编译并烧录。诊断版另备份于本机 `/tmp/radio-seek-library-diagnostic`，原版于 `/tmp/radio-seek-library-original`；Git 中的补丁及指纹不依赖临时备份。

## 验证

```bash
python3 radio-device/tests/playback_test.py
python3 radio-device/tests/library_seek_test.py
```

后者直接提取指纹匹配的已修复库函数，用主机 I/O 替身验证 Range 响应、错误拒绝、文件总长与失败后不读旧流；不替代 Arduino 编译或真机验收。自定义库路径可设置 `RADIO_AUDIO_LIBRARY_DIR`。

首轮修复已确认 Range 请求发出、返回 206、目标字节范围验证通过；随后旧预填量 65,535 字节在 3 秒内只收到 54,168 字节，仍停止。证据见 [seek-trace-before-prefill.txt](seek-trace-before-prefill.txt)，因此随后将 HTTP WAV 预填量限制为两个解码块。

最终修复版已编译与烧录，2026-10-05 真机日志 [seek-trace-fixed.txt](seek-trace-fixed.txt) 确认：

```text
startOffsetMs: 8073
[seek] initial.range-supported: supported=1 fileSize=2688044
[seek] range.status: HTTP=206
[seek] range.validated: position=512044 fileSize=2688044
[seek] new-buffer.read: read=8192 expected=8192
[seek] new-buffer.align: offset=0 codec=1
[seek] new-buffer.result: position=512044 ok=1
audio seek applied: position=512044
```

原生 seek 实际跳转至 8 秒，后续 Range / 重填 / WAV 对齐全部通过。随后观察到自然 EOF、`audio playback completed` 和 `completed request succeeded`；用户听感确认已出声，但仍断断续续；seek 已通过，连续播放流畅度尚未通过。只读节目接口核对自然完成后 `retired_at` 已设置，见 [seek-program-after-completed.json](seek-program-after-completed.json)。

编译占用 2,083,967 字节（66% flash）、全局变量 60,260 字节（18% RAM）。主机两组回归、实际 ESP32-S3 编译、烧录校验与补丁正反向应用均通过。

用户随后再次确认 5 秒 seek（位置 320044）时 Range 206、8 KiB 重填及 WAV 对齐成功；声音断续仍存在，按用户要求暂缓排查，可继续后续开发。
