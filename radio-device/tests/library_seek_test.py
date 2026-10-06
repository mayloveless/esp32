"""Exercise the patched library's real seek functions with host I/O fakes.
Apply the documented library patches first. No network, Arduino or audio output.
"""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
library = Path(os.environ.get('RADIO_AUDIO_LIBRARY_DIR', str(Path.home() / 'Documents/Arduino/libraries/ESP32-audioI2S-master')))
source = (library / 'src/Audio.cpp').read_text()
hashes = json.loads((root / 'patches/library-hashes.json').read_text())
for filename, fingerprint in hashes.items():
    assert hashlib.sha256((library / 'src' / filename).read_bytes()).hexdigest() == fingerprint.get('mutexGuard', fingerprint['fixed']), f'Apply the current seek fix first: {filename}'

def function(signature):
    start = source.index(signature)
    opening = source.index('{', start)
    depth = 1
    end = opening + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end] + '\n'

preamble = r'''
#include "RadioHttpRange.h"
#include <algorithm>
#include <cassert>
#include <cctype>
#include <cstdlib>
#include <string>
#include <vector>
using std::size_t;
template<class T> struct ps_ptr {
    std::string text;
    ps_ptr() = default;
    ps_ptr(const char* value): text(value) {}
    bool valid() const { return !text.empty(); }
    const char* c_get() const { return text.c_str(); }
    const char* get() const { return text.c_str(); }
    size_t strlen() const { return text.size(); }
    void reset() { text.clear(); }
    int index_of(char ch) const {
        auto p = text.find(ch);
        return p == std::string::npos ? -1 : static_cast<int>(p);
    }
    ps_ptr substr(size_t start, size_t count = std::string::npos) const {
        ps_ptr out; out.text = text.substr(start, count); return out;
    }
    void trim() {
        auto start = text.find_first_not_of(" \t\r\n");
        if (start == std::string::npos) { text.clear(); return; }
        text = text.substr(start, text.find_last_not_of(" \t\r\n") - start + 1);
    }
    bool starts_with_icase(const char* value) const {
        std::string prefix(value);
        if (prefix.size() > text.size()) return false;
        for (size_t i = 0; i < prefix.size(); ++i)
            if (std::tolower(text[i]) != std::tolower(prefix[i])) return false;
        return true;
    }
    bool equals_icase(const char* value) const {
        return strlen() == std::strlen(value) && starts_with_icase(value);
    }
    uint32_t to_uint32() const { return static_cast<uint32_t>(std::strtoul(c_get(), nullptr, 10)); }
};
constexpr int AUDIO_NONE = 0, HTTP_RESPONSE_HEADER = 1, HTTP_RANGE_HEADER = 2, AUDIO_DATA = 3, AUDIO_PLAYLISTINIT = 4, AUDIO_LOCALFILE = 5;
constexpr int ST_WEBSTREAM = 0, ST_WEBFILE = 1, FORMAT_NONE = 0, FORMAT_M3U8 = 8, CODEC_NONE = 0;
constexpr int CODEC_WAV = 1, CODEC_M4A = 2, CODEC_MP3 = 3, CODEC_FLAC = 4, CODEC_VORBIS = 5, CODEC_OPUS = 6;
constexpr int configTICK_RATE_HZ = 100;
int locks = 0;
bool xSemaphoreTake(int, int) { ++locks; return true; }
void xSemaphoreGive(int) { --locks; assert(locks >= 0); }
#define AUDIO_LOG_ERROR(...) do { error = true; } while (0)
#define AUDIO_LOG_WARN(...) do {} while (0)
#define AUDIO_LOG_DEBUG(...) do {} while (0)
#define AUDIO_LOG_INFO(...) do {} while (0)
struct Buffer {
    int resets = 0, written = 0, consumed = 0;
    uint8_t bytes[65535]{};
    uint32_t getMaxBlockSize() { return 4096; }
    void reset() { ++resets; }
    uint8_t* getWritePtr() { return bytes; }
    void bytesWritten(int n) { written += n; }
    void bytesWasRead(int n) { consumed += n; }
    int readSpace() { return written - consumed; }
};
struct File {
    uint32_t pos = 0, length = 3000000;
    explicit operator bool() const { return true; }
    uint32_t position() { return pos; }
    uint32_t size() { return length; }
    bool seek(uint32_t p) { pos = p; return true; }
};
struct Decoder { int clears = 0; void clear() { ++clears; } };
struct Audio {
    enum class HeaderResult { Continue, ContentTypeSeen, Redirect, Error };
    int m_dataMode = HTTP_RESPONSE_HEADER, m_metaint = 0;
    int m_streamType = ST_WEBFILE, m_playlistFormat = FORMAT_NONE, m_codec = CODEC_WAV;
    uint32_t m_audioFileSize = 1000000, m_audioFilePosition = 0, m_audioDataStart = 44;
    uint32_t m_audioDataSize = 999956, m_audioDataReadPtr = 0, m_stsz_position = 1;
    int32_t m_resumeFilePos = 448044;
    int m_controlCounter = 100, mutex_audioTaskIsDecoding = 1;
    bool m_f_acceptRanges = false, m_f_chunked = false, m_f_tts = false, m_f_running = true;
    bool m_f_lockInBuffer = false, m_f_allDataReceived = false, error = false;
    struct { bool f_icy_data = false; void reset() { f_icy_data = false; } } m_phreh;
    ps_ptr<char> m_m3u8_host, m_lastHost;
    File m_audiofile;
    Buffer InBuff;
    Decoder decoder;
    Decoder* m_decoder = &decoder;
    std::vector<ps_ptr<char>> headers;
    int requests = 0, headerReads = 0, bodyReads = 0, stops = 0;
    int alignment = 0;
    bool requestOK = true, bodyOK = true;
    uint32_t requestedPosition = 0, requestedLength = 0;
    std::vector<ps_ptr<char>> readHeader() { ++headerReads; return headers; }
    HeaderResult parseHeaderLine(ps_ptr<char> name, ps_ptr<char> value, ps_ptr<char>&) {
        if (name.equals_icase("content-type")) return HeaderResult::ContentTypeSeen;
        if (name.equals_icase("accept-ranges") && value.equals_icase("bytes")) m_f_acceptRanges = true;
        if (name.equals_icase("content-length")) m_audioFileSize = value.to_uint32();
        if (name.equals_icase("transfer-encoding") && value.equals_icase("chunked")) m_f_chunked = true;
        if (name.starts_with_icase("http/") && std::atoi(name.get() + 9) > 310) return HeaderResult::Error;
        return HeaderResult::Continue;
    }
    void httpPrint(const char*) {}
    bool httpRange(uint32_t position, uint32_t length) {
        ++requests; requestedPosition = position; requestedLength = length;
        if (requestOK) m_dataMode = HTTP_RANGE_HEADER;
        return requestOK;
    }
    void seekDiagnostic(const char*, int32_t = 0, int32_t = 0) {}
    void stopSong() { ++stops; m_f_running = false; m_f_lockInBuffer = false; }
    int32_t audioFileRead(uint8_t*, size_t n, uint16_t) {
        ++bodyReads;
        if (!bodyOK) return -1;
        m_audioFilePosition += n;
        return n;
    }
    int32_t wav_correctResumeFilePos() { return alignment; }
    int32_t m4a_correctResumeFilePos() { return alignment; }
    int32_t mp3_correctResumeFilePos() { return alignment; }
    int32_t flac_correctResumeFilePos() { return alignment; }
    int32_t ogg_correctResumeFilePos() { return alignment; }
    bool parseHttpResponseHeader();
    bool parseHttpRangeHeader(uint32_t, uint32_t);
    int32_t audioFileSeek(uint32_t, size_t = 0);
    int32_t newInBuffStart(int32_t);
};
'''
cases = r'''
std::vector<ps_ptr<char>> headers(int status = 206, const char* range = "bytes 448044-999999/1000000", const char* length = "551956") {
    std::vector<ps_ptr<char>> out;
    out.emplace_back(("HTTP/1.1 " + std::to_string(status) + " response").c_str());
    out.emplace_back("Content-Type: audio/wav");
    if (range) out.emplace_back((std::string("Content-Range: ") + range).c_str());
    if (length) out.emplace_back((std::string("Content-Length: ") + length).c_str());
    return out;
}
void assertFailed(Audio& audio) {
    assert(audio.newInBuffStart(audio.m_resumeFilePos) == -1);
    assert(audio.bodyReads == 0 && audio.InBuff.resets == 0);
    assert(audio.stops == 1 && !audio.m_f_running && locks == 0);
}
int main() {
    using namespace radio_http_range;
    ByteRange range;
    assert(parse("bytes 0-999999/1000000", range));
    assert(matches(206, range, 0, UINT32_MAX, 1000000, true, 1000000));
    for (const char* value : {"", "bytes */1000000", "bytes 10-1/20", "bytes 0-20/20", "bytes 0-0/0", "bytes 0-1/*", "bytes 0-1/4294967296", "bytes 0-1/20 junk", "items 0-1/20", "bytes 0", "bytes 0-1"})
        assert(!parse(value, range));
    assert(!parse(nullptr, range));
    assert(parse("bytes 448044-999999/1000000", range));
    assert(matches(206, range, 448044, UINT32_MAX, 1000000, true, 551956));
    assert(!matches(200, range, 448044, UINT32_MAX, 1000000, true, 551956));
    assert(!matches(206, range, 448045, UINT32_MAX, 1000000, true, 551956));
    assert(!matches(206, range, 448044, UINT32_MAX, 1000001, true, 551956));
    assert(!matches(206, range, 448044, UINT32_MAX, 1000000, true, 551955));
    // Missing Accept-Ranges must not block a proven 206 byte response.
    Audio initial; initial.headers = headers(206, "bytes 0-999999/1000000", "1000000");
    assert(initial.parseHttpResponseHeader() && initial.m_f_acceptRanges);
    assert(initial.m_audioFileSize == 1000000 && initial.m_dataMode == AUDIO_DATA);
    Audio full; full.headers = headers(200, nullptr, "1000000");
    assert(full.parseHttpResponseHeader() && !full.m_f_acceptRanges);
    Audio advertised; advertised.headers = headers(200, nullptr, "1000000");
    advertised.headers.emplace_back("Accept-Ranges: bytes");
    assert(advertised.parseHttpResponseHeader() && advertised.m_f_acceptRanges);
    Audio unproven; unproven.headers = headers(206, "bytes 10-999999/1000000", "999990");
    assert(unproven.parseHttpResponseHeader() && !unproven.m_f_acceptRanges);
    // Valid seek restores total size despite the shorter response body.
    Audio ok; ok.m_dataMode = AUDIO_DATA; ok.m_f_acceptRanges = true; ok.headers = headers();
    assert(ok.newInBuffStart(ok.m_resumeFilePos) == 448044);
    assert(ok.requests == 1 && ok.requestedPosition == 448044 && ok.requestedLength == UINT32_MAX);
    assert(ok.headerReads == 1 && ok.bodyReads == 1 && ok.m_audioFileSize == 1000000);
    assert(ok.InBuff.written == 8192); // WAV prefill is two decoder blocks.
    assert(ok.m_audioDataReadPtr == 448000 && ok.decoder.clears == 1 && locks == 0);
    assert(ok.stops == 0 && ok.m_f_running);
    Audio compressed; compressed.m_dataMode = AUDIO_DATA; compressed.m_f_acceptRanges = true;
    compressed.m_codec = CODEC_MP3; compressed.headers = headers();
    assert(compressed.newInBuffStart(compressed.m_resumeFilePos) == 448044);
    assert(compressed.InBuff.written == 65535); // Other codecs retain native prefill.
    Audio tail; tail.m_dataMode = AUDIO_DATA; tail.m_f_acceptRanges = true;
    tail.m_resumeFilePos = 995000; tail.headers = headers(206, "bytes 995000-999999/1000000", "5000");
    assert(tail.newInBuffStart(tail.m_resumeFilePos) == 995000);
    assert(tail.InBuff.written == 5000); // Do not read past the data end.
    Audio noLength; noLength.m_dataMode = AUDIO_DATA; noLength.m_f_acceptRanges = true;
    noLength.headers = headers(206, "bytes 448044-999999/1000000", nullptr);
    assert(noLength.audioFileSeek(448044) == 448044 && noLength.m_audioFileSize == 1000000);
    Audio finite; finite.m_dataMode = AUDIO_DATA; finite.m_f_acceptRanges = true;
    finite.headers = headers(206, "bytes 448044-448059/1000000", "16");
    assert(finite.audioFileSeek(448044, 15) == 448044 && finite.m_audioFileSize == 1000000);
    // Never consume old/full-file data after a rejected seek response.
    for (int status : {200, 302, 403, 416}) {
        Audio bad; bad.m_dataMode = AUDIO_DATA; bad.m_f_acceptRanges = true; bad.headers = headers(status);
        assertFailed(bad);
    }
    for (const char* value : std::vector<const char*>{nullptr, "bytes 0-999999/1000000", "bytes 448044-999999/1000001", "bytes 448044-999998/1000000", "bytes 448044-999999/*"}) {
        Audio bad; bad.m_dataMode = AUDIO_DATA; bad.m_f_acceptRanges = true; bad.headers = headers(206, value);
        assertFailed(bad);
    }
    Audio shortBody; shortBody.m_dataMode = AUDIO_DATA; shortBody.m_f_acceptRanges = true;
    shortBody.headers = headers(206, "bytes 448044-999999/1000000", "123"); assertFailed(shortBody);
    Audio empty; empty.m_dataMode = AUDIO_DATA; empty.m_f_acceptRanges = true; assertFailed(empty);
    Audio noSupport; noSupport.m_dataMode = AUDIO_DATA; assertFailed(noSupport);
    assert(noSupport.requests == 0 && noSupport.headerReads == 0);
    Audio disconnected; disconnected.m_dataMode = AUDIO_DATA; disconnected.m_f_acceptRanges = true;
    disconnected.requestOK = false; assertFailed(disconnected); assert(disconnected.headerReads == 0);
    Audio chunked; chunked.m_dataMode = AUDIO_DATA; chunked.m_f_acceptRanges = true; chunked.headers = headers();
    chunked.headers.emplace_back("Transfer-Encoding: chunked"); assertFailed(chunked);
    // A genuine body timeout still fails, rather than accepting wrong data.
    Audio timeout; timeout.m_dataMode = AUDIO_DATA; timeout.m_f_acceptRanges = true;
    timeout.headers = headers(); timeout.bodyOK = false;
    assert(timeout.newInBuffStart(timeout.m_resumeFilePos) == -1);
    assert(timeout.bodyReads == 1 && timeout.stops == 1 && locks == 0);
    // Byte zero is a valid return value, distinct from seek failure (-1).
    Audio zero; zero.m_dataMode = AUDIO_DATA; zero.m_f_acceptRanges = true;
    zero.headers = headers(206, "bytes 0-999999/1000000", "1000000");
    assert(zero.audioFileSeek(0) == 0);
    Audio local; local.m_dataMode = AUDIO_LOCALFILE;
    assert(local.audioFileSeek(123) == 123 && local.requests == 0);
}
'''
functions = ''.join(function(signature) for signature in (
    'bool Audio::parseHttpResponseHeader()', 'bool Audio::parseHttpRangeHeader(',
    'int32_t Audio::audioFileSeek(', 'int32_t Audio::newInBuffStart('))
with tempfile.TemporaryDirectory(prefix='radio-library-seek-') as directory:
    cpp, binary = Path(directory) / 'seek.cpp', Path(directory) / 'seek-test'
    cpp.write_text(preamble + functions + cases)
    subprocess.run([os.environ.get('CXX', 'clang++'), '-std=c++17', '-Wall', '-Wextra', '-Wno-unused-variable', '-Wno-sign-compare', '-I', str(library / 'src'), str(cpp), '-o', str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
print('Patched native seek checks passed (host fakes, not hardware).')
