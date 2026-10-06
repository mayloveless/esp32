"""Run the experiment's actual native API/range/validation with host transport fakes."""
from pathlib import Path
import ast
import hashlib
import json
import os
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
library = Path(os.environ.get('RADIO_AUDIO_LIBRARY_DIR', str(Path.home() / 'Documents/Arduino/libraries/ESP32-audioI2S-master')))
source = (library / 'src/Audio.cpp').read_text()
hashes = json.loads((root / 'patches/library-hashes.json').read_text())
for name in ['Audio.cpp', 'Audio.h', 'RadioFastWav.h']:
    assert hashlib.sha256((library / 'src' / name).read_bytes()).hexdigest() == hashes[name]['fastWavStart']
# The real initial request has a finite branch; normal callers retain bytes=0-.
assert 'if (finiteWavHeader) rqh.appendf("Range: bytes=0-{}\\r\\n", radio_fast_wav::kInitialBytes - 1);' in source
assert 'else rqh.append("Range: bytes=0-\\r\\n");' in source

def function(signature):
    start = source.index(signature); end = source.index('{', start) + 1; depth = 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}'); end += 1
    return source[start:end] + '\n'

# Share the existing HTTP header fake rather than invent a second parser.
tree = ast.parse((root / 'tests/library_seek_test.py').read_text())
preamble = next(ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'preamble' for t in n.targets))
preamble = preamble[:preamble.index('struct Audio {')]
preamble = preamble.replace('text(value)', 'text(value ? value : "")')
preamble = preamble.replace('#include "RadioHttpRange.h"', '#include "RadioHttpRange.h"\n#include "RadioFastWav.h"\n#include <memory>')
preamble = preamble.replace('    bool valid() const', '''    void assign(const char* value) { text = value; }
    void clone_from(const ps_ptr& value) { text = value.text; }
    void append(const char* value) { text += value; }
    void append(const ps_ptr& value) { text += value.text; }
    template<class V> static std::string value(V v) { return std::to_string(v); }
    static std::string value(const char* v) { return v; }
    static std::string value(const ps_ptr& v) { return v.text; }
    static std::string format(std::string fmt) { return fmt; }
    template<class V, class... R> static std::string format(std::string fmt, V v, R... rest) {
        auto p = fmt.find("{}"); if (p == std::string::npos) return fmt;
        return fmt.substr(0,p) + value(v) + format(fmt.substr(p+2),rest...);
    }
    template<class... V> void assignf(const char* fmt, V... v) { text = format(fmt,v...); }
    template<class... V> void appendf(const char* fmt, V... v) { text += format(fmt,v...); }
    bool calloc(size_t n, const char*) { text.resize(n); return true; }
    bool ends_with_icase(const char* suffix) const {
        auto n=std::strlen(suffix); if (text.size()<n) return false;
        return ps_ptr(text.substr(text.size()-n).c_str()).equals_icase(suffix);
    }
    bool contains(const char* value) const { return text.find(value)!=std::string::npos; }
    bool valid() const''',1)
preamble = preamble.replace('int locks = 0;', 'int locks = 0; bool lockOK = true;')
preamble = preamble.replace('++locks; return true;', 'if (!lockOK) return false; ++locks; return true;')
preamble = preamble.replace('error = true;', '(void)0;')
preamble = preamble.replace('struct Decoder { int clears = 0; void clear() { ++clears; } };', '''struct Decoder {
    int clears = 0; void clear() { ++clears; }
    void setRawBlockParams(uint16_t, uint32_t, uint16_t, int, int) {}
};''')
preamble = preamble.replace('    int readSpace()', '    size_t bufferFilled() { return 0; }\n    uint8_t* getReadPtr() { return bytes; }\n    size_t readSpace()')
preamble += r'''
constexpr int pdTRUE = 1, CODEC_AAC = 7, CODEC_OGG = 8;
constexpr int FORMAT_ASX = 1, FORMAT_M3U = 2, FORMAT_PLS = 3;
constexpr int evt_info = 1, evt_lasthost = 2;
using std::min;
void vTaskDelay(int) {}
template<class... V> void info(V...) {}
size_t base64_encode_expected_len(size_t n) { return n*2; }
void b64encode(const char*,size_t,const char*) {}
template<> struct ps_ptr<uint8_t> {
    std::vector<uint8_t> bytes;
    bool calloc(size_t n, const char*) { bytes.resize(n); return true; }
    uint8_t* get() { return bytes.data(); }
    void reset() { bytes.clear(); }
};
struct Host { bool ssl = true; uint16_t port = 443; ps_ptr<char> hwoe{"example.test"}, rqh_host{"example.test"}, extension{"audio.wav"}, query_string{"token=private"}; };
Host dismantle_host(const char*) { return {}; }
ps_ptr<char> urlencode(const char* p, bool) { return p; }
struct NetworkClient {
    bool open = false, consumed = false;
    int connects = 0, stops = 0, writes = 0;
    std::string request; std::vector<std::string> sent;
    bool connected() { return open; }
    void stop() { ++stops; open = false; }
    void setTimeout(uint16_t) {}
    bool connect(const char*, uint16_t) { ++connects; open = true; return true; }
    size_t print(const char* p) {
        assert(writes == 0 || consumed); // second GET requires consumed first body
        ++writes; request = p; sent.emplace_back(p); return request.size();
    }
};
using NetworkClientSecure = NetworkClient;
struct Audio {
    enum class HeaderResult { Continue, ContentTypeSeen, Redirect, Error };
    int m_dataMode = HTTP_RESPONSE_HEADER, m_streamType = ST_WEBFILE, m_codec = CODEC_WAV;
    uint32_t m_audioFileSize = 0, m_audioFilePosition = 0, m_audioDataStart = 0, m_audioDataSize = 0;
    uint32_t m_audioDataReadPtr = 0, m_audioFileDuration = 0, m_nominal_bitrate = 0, m_haveNewFilePos = 0;
    int32_t m_resumeFilePos = -1;
    int m_controlCounter = 0, mutex_audioTaskIsDecoding = 1;
    bool m_f_running = false, m_f_ssl = true, m_f_connectionClose = false;
    bool m_f_acceptRanges = false, m_f_chunked = false, m_f_firstCall = true;
    bool m_f_lockInBuffer = false, m_f_allDataReceived = false;
    bool m_f_firstPlayCall = true, m_f_eof = false, m_f_ID3v1TagFound = false;
    bool m_f_stream = true, m_f_tts = false;
    int m_validSamples = 0, m_playlistFormat = FORMAT_NONE, m_bytesNotConsumed = 0;
    struct { int count = 0, bytesDecoded = 0; size_t bytesToDecode = 0, oldAudioDataSize = 0; bool lastFrames = false; } m_pad;
    Buffer SamplesBuff;
    void playAudioData();
    void playChunk() {}
    void cacheSamples() {}
    int sendBytes(uint8_t*, size_t n) { return n; }
    struct { bool audioHeaderFound = false; int32_t newFilePos = 0; uint32_t ctime = 0, timeout = 0, maxFrameSize = 0; } m_pwf;
    NetworkClient client, clientsecure;
    NetworkClient* m_client = &clientsecure;
    int m_expectedCodec = CODEC_NONE, m_expectedPlsFmt = FORMAT_NONE;
    uint16_t m_timeout_ms_ssl = 15000, m_timeout_ms = 8000;
    ps_ptr<char> m_lastHost;
    ps_ptr<char> m_currentHost{"https://example.test/audio.wav?token=private"};
    Buffer InBuff;
    Decoder decoder; Decoder* m_decoder = &decoder;
    std::vector<uint8_t> initial;
    std::vector<std::vector<ps_ptr<char>>> responses;
    std::vector<std::string> events;
    int bodyReads = 0, failureStage = 0;
    bool incomplete = false, closeAfterBody = false, decoderOK = true;
    bool connecttohostRequest(const char*, const char*, const char*, bool);
    void setDefaults() { m_audioFileSize=0; m_f_running=false; m_f_firstCall=true; }
    bool initializeDecoder() { return decoderOK; }
    std::vector<ps_ptr<char>> readHeader() {
        assert(!responses.empty()); auto h = responses.front(); responses.erase(responses.begin()); return h;
    }
    HeaderResult parseHeaderLine(ps_ptr<char> name, ps_ptr<char> value, ps_ptr<char>&) {
        if (name.equals_icase("content-type")) return HeaderResult::ContentTypeSeen;
        if (name.equals_icase("content-length")) m_audioFileSize = value.to_uint32();
        if (name.equals_icase("transfer-encoding") && value.equals_icase("chunked")) m_f_chunked = true;
        if (name.equals_icase("connection") && value.equals_icase("close")) m_f_connectionClose = true;
        if (name.starts_with_icase("http/") && std::atoi(name.get()+9) > 310) return HeaderResult::Error;
        return HeaderResult::Continue;
    }
    void seekDiagnostic(const char* tag, int32_t a = 0, int32_t = 0) {
        events.emplace_back(tag); if (!std::strcmp(tag,"radio.fast.failed")) failureStage = a;
    }
    void stopSong() { m_f_running = false; m_f_lockInBuffer = false; }
    int32_t audioFileRead(uint8_t* out, size_t n, uint16_t timeout) {
        assert(timeout == 3000); ++bodyReads;
        if (bodyReads == 1) {
            assert(n == radio_fast_wav::kInitialBytes);
            if (incomplete) return n / 2;
            std::memcpy(out,initial.data(),n); m_client->consumed = true;
            if (closeAfterBody) m_client->open = false;
        } else { assert(m_client->writes == 2); std::memset(out,0x55,n); }
        m_audioFilePosition += n; return n;
    }
    bool connecttohostAtTime(const char*, uint16_t);
    bool httpRange(uint32_t, uint32_t = UINT32_MAX, bool = false);
    bool parseHttpRangeHeader(uint32_t, uint32_t, bool = false);
};
'''
cases = r'''
void put16(std::vector<uint8_t>& b, size_t p, uint16_t n) { b[p]=n; b[p+1]=n>>8; }
void put32(std::vector<uint8_t>& b, size_t p, uint32_t n) { for (int i=0;i<4;++i) b[p+i]=n>>(8*i); }
std::vector<uint8_t> wav(uint16_t align=2) {
    std::vector<uint8_t> b(8192,0x11);
    // Include an odd-sized JUNK chunk: dataStart=54, not 44.
    std::memcpy(b.data(),"RIFF",4); put32(b,4,1000000-8); std::memcpy(b.data()+8,"WAVE",4);
    std::memcpy(b.data()+12,"JUNK",4); put32(b,16,1); b[20]=0; b[21]=0;
    std::memcpy(b.data()+22,"fmt ",4); put32(b,26,16); put16(b,30,1);
    put16(b,32,1); put32(b,34,32000); put32(b,38,32000*align); put16(b,42,align); put16(b,44,align*8);
    std::memcpy(b.data()+46,"data",4); put32(b,50,1000000-54);
    return b;
}
std::vector<ps_ptr<char>> response(int status, const std::string& range, const std::string& length) {
    return {ps_ptr<char>(("HTTP/1.1 "+std::to_string(status)+" response").c_str()),
            ps_ptr<char>(("Content-Range: "+range).c_str()), ps_ptr<char>(("Content-Length: "+length).c_str()), ps_ptr<char>("Content-Type: audio/wav")};
}
void prepare(Audio& a) {
    a.initial=wav();
    a.responses={response(206,"bytes 0-" + std::to_string(radio_fast_wav::kInitialBytes - 1) + "/1000000",std::to_string(radio_fast_wav::kInitialBytes)),response(206,"bytes 448054-999999/1000000","551946")};
}
int main() {
    Audio a; prepare(a); assert(a.connecttohostAtTime("https://example.test/audio.wav",7));
    assert(a.clientsecure.connects == 1 && a.clientsecure.stops == 0 && a.clientsecure.writes == 2);
    assert(a.clientsecure.sent[0].find("Range: bytes=0-" + std::to_string(radio_fast_wav::kInitialBytes - 1) + "\r\n") != std::string::npos);
    assert(a.clientsecure.request.find("Range: bytes=448054-\r\n") != std::string::npos);
    assert(a.bodyReads == 2 && a.InBuff.written == 8192 && a.InBuff.bytes[0] == 0x55);
    assert(a.m_audioDataStart == 54 && a.m_haveNewFilePos == 448054 && a.m_audioDataReadPtr == 448000);
    assert(!a.m_f_firstCall && a.m_resumeFilePos == -1 && a.m_audioFileSize == 1000000 && locks == 0);
    // Exercise the real first decode call: it must retain the offset, then EOF
    // must be reached after exactly the remaining response, without a stall.
    a.playAudioData();
    assert(a.m_audioDataReadPtr == 448000 + 8192);
    a.InBuff.written = 551946;
    a.InBuff.consumed = 8192;
    for (int i=0; i<200 && !a.m_f_eof; ++i) a.playAudioData();
    assert(a.m_f_eof && a.m_audioDataReadPtr == a.m_audioDataSize);
    assert(a.m_nominal_bitrate == 512000); // actual clock patch tests this first-frame rebase separately
    Audio partial; prepare(partial); partial.incomplete=true;
    assert(!partial.connecttohostAtTime("https://example.test/audio.wav",7) && partial.failureStage == 3 && partial.clientsecure.writes == 1);
    Audio closed; prepare(closed); closed.closeAfterBody=true;
    assert(!closed.connecttohostAtTime("https://example.test/audio.wav",7) && closed.failureStage == 5 && closed.clientsecure.writes == 1);
    Audio connectionClose; prepare(connectionClose); connectionClose.responses[0].emplace_back("Connection: close");
    assert(!connectionClose.connecttohostAtTime("https://example.test/audio.wav",7) && connectionClose.failureStage == 5);
    for (int status : {200,302,403,416}) {
        Audio bad; prepare(bad); bad.responses[0][0]=ps_ptr<char>(("HTTP/1.1 "+std::to_string(status)+" response").c_str());
        assert(!bad.connecttohostAtTime("https://example.test/audio.wav",7) && bad.bodyReads == 0 && bad.InBuff.written == 0);
        Audio second; prepare(second); second.responses[1][0]=ps_ptr<char>(("HTTP/1.1 "+std::to_string(status)+" response").c_str());
        assert(!second.connecttohostAtTime("https://example.test/audio.wav",7) && second.bodyReads == 1 && second.InBuff.written == 0);
    }
    for (const char* range : {"bytes 0-999999/1000000", "bytes 1-8192/1000000", "garbage", "bytes 0-8191/*"}) {
        Audio bad; prepare(bad); bad.responses[0][1]=ps_ptr<char>((std::string("Content-Range: ")+range).c_str());
        assert(!bad.connecttohostAtTime("https://example.test/audio.wav",7) && bad.clientsecure.writes == 1);
    }
    for (const char* range : {"bytes 448056-999999/1000000", "bytes 448054-1000001/1000002", "garbage"}) {
        Audio bad; prepare(bad); bad.responses[1][1]=ps_ptr<char>((std::string("Content-Range: ")+range).c_str());
        assert(!bad.connecttohostAtTime("https://example.test/audio.wav",7) && bad.bodyReads == 1 && bad.InBuff.written == 0);
    }
    for (const char* value : {"8191", "4095", "8192garbage", "4294967296"}) {
        Audio bad; prepare(bad); bad.responses[0][2]=ps_ptr<char>((std::string("Content-Length: ")+value).c_str());
        assert(!bad.connecttohostAtTime("https://example.test/audio.wav",7) && bad.clientsecure.writes == 1);
    }
    Audio missing; prepare(missing); missing.responses[0].erase(missing.responses[0].begin()+2);
    assert(!missing.connecttohostAtTime("https://example.test/audio.wav",7));
    Audio duplicate; prepare(duplicate); duplicate.responses[0].emplace_back("Content-Length: 8192");
    assert(!duplicate.connecttohostAtTime("https://example.test/audio.wav",7));
    for (const char* framing : {"Transfer-Encoding: chunked", "Transfer-Encoding: identity", "Content-Encoding: gzip"}) {
        Audio bad; prepare(bad); bad.responses[0].emplace_back(framing); assert(!bad.connecttohostAtTime("https://example.test/audio.wav",7));
    }
    Audio locked; prepare(locked); lockOK=false;
    assert(!locked.connecttohostAtTime("https://example.test/audio.wav",7) && locked.failureStage==8 && locks==0); lockOK=true;
    Audio notPcm; prepare(notPcm); put16(notPcm.initial,30,3); assert(!notPcm.connecttohostAtTime("https://example.test/audio.wav",7));
    Audio invalidRate; prepare(invalidRate); put32(invalidRate.initial,38,42); assert(!invalidRate.connecttohostAtTime("https://example.test/audio.wav",7));
    Audio badAlign; prepare(badAlign); put16(badAlign.initial,42,3); assert(!badAlign.connecttohostAtTime("https://example.test/audio.wav",7));
    Audio late; prepare(late); assert(!late.connecttohostAtTime("https://example.test/audio.wav",99) && late.clientsecure.writes==1);
    radio_fast_wav::Header header; auto b=wav(); assert(radio_fast_wav::parse(b.data(),b.size(),1000000,header));
    uint32_t target=0; assert(radio_fast_wav::target(header,7,target) && (target-header.dataStart)%header.blockAlign==0);
    assert(!radio_fast_wav::parse(b.data(),40,1000000,header));
    // Both proposed finite windows still parse real chunks (including padding).
    assert(radio_fast_wav::parse(b.data(),4096,1000000,header) && header.dataStart == 54);
    auto beyondWindow = wav();
    put32(beyondWindow,16,9000); // declared JUNK crosses even the 8192 boundary
    assert(!radio_fast_wav::parse(beyondWindow.data(),4096,1000000,header));
    assert(!radio_fast_wav::parse(beyondWindow.data(),8192,1000000,header));
    Audio oversizedHeader; prepare(oversizedHeader); oversizedHeader.initial = beyondWindow;
    assert(!oversizedHeader.connecttohostAtTime("https://example.test/audio.wav",7));
    assert(oversizedHeader.failureStage == 4 && oversizedHeader.clientsecure.writes == 1);
    assert(oversizedHeader.InBuff.written == 0 && !oversizedHeader.m_f_running && locks == 0);
    // A genuine data header between the two limits is supported at 8192,
    // and safely rejected before the target GET at 4096.
    Audio wide; prepare(wide); wide.initial.assign(8192,0);
    std::memcpy(wide.initial.data(),"RIFF",4); put32(wide.initial,4,999992);
    std::memcpy(wide.initial.data()+8,"WAVE",4);
    std::memcpy(wide.initial.data()+12,"JUNK",4); put32(wide.initial,16,5948);
    std::memcpy(wide.initial.data()+5968,"fmt ",4); put32(wide.initial,5972,16);
    put16(wide.initial,5976,1); put16(wide.initial,5978,1); put32(wide.initial,5980,32000);
    put32(wide.initial,5984,64000); put16(wide.initial,5988,2); put16(wide.initial,5990,16);
    std::memcpy(wide.initial.data()+5992,"data",4); put32(wide.initial,5996,994000);
    wide.responses[1] = response(206,"bytes 454000-999999/1000000","546000");
    if (radio_fast_wav::kInitialBytes == 4096) {
        assert(!wide.connecttohostAtTime("https://example.test/audio.wav",7));
        assert(wide.failureStage == 4 && wide.clientsecure.writes == 1 && wide.InBuff.written == 0);
    } else {
        assert(wide.connecttohostAtTime("https://example.test/audio.wav",7));
        assert(wide.m_audioDataStart == 6000 && wide.m_audioDataReadPtr == 448000);
    }
    // Normal httpRange still reconnects; the reuse flag is opt-in.
    Audio legacy; legacy.m_f_running=true; legacy.clientsecure.open=true; legacy.clientsecure.consumed=true;
    assert(legacy.httpRange(448054,UINT32_MAX)); assert(legacy.clientsecure.stops==1 && legacy.clientsecure.connects==1);
}
'''
actual = ''.join(function(sig) for sig in ['bool Audio::connecttohostRequest(', 'bool Audio::connecttohostAtTime(', 'bool Audio::httpRange(', 'bool Audio::parseHttpRangeHeader(', 'void Audio::playAudioData('])
with tempfile.TemporaryDirectory(prefix='radio-fast-wav-test-') as folder:
    cpp=Path(folder)/'fast.cpp'; binary=Path(folder)/'fast'; cpp.write_text(preamble+actual+cases)
    for window in (8192, 4096):
        subprocess.run(['c++','-std=c++17',f'-DRADIO_FAST_WAV_INITIAL_BYTES={window}','-fsanitize=address,undefined','-g','-I',str(library/'src'),str(cpp),'-o',str(binary)],check=True)
        subprocess.run([str(binary)],check=True)
print('Native fast WAV API/body-boundary/same-client/range/format/clock-state checks passed.')
