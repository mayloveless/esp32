#include <Arduino.h>
#include <ESP_I2S.h>
#include <math.h>

#define I2S_BCLK 4
#define I2S_LRC 5
#define I2S_DIN 6
#define ENCODER_CLK 7
#define ENCODER_DT 15
#define ENCODER_KEY 16

I2SClass i2s;
int bpm = 120;
bool playing = false;
int lastCLK;
bool lastKey = HIGH;

void audioBegin(){
  i2s.setPins(I2S_BCLK,I2S_LRC,I2S_DIN);
  if(i2s.begin(I2S_MODE_STD,32000,I2S_DATA_BIT_WIDTH_16BIT,I2S_SLOT_MODE_MONO)) Serial.println("Audio OK");
}

void playTone(float hz,int ms){
  int16_t buf[128];
  float phase=0;
  float step=2*PI*hz/32000;
  for(int i=0;i<32000*ms/1000;i+=128){
    for(int j=0;j<128;j++){
      buf[j]=sin(phase)*3000;
      phase+=step;
      if(phase>2*PI) phase-=2*PI;
    }
    i2s.write((uint8_t*)buf,sizeof(buf));
  }
}

void setup(){
  Serial.begin(115200);
  pinMode(ENCODER_CLK,INPUT_PULLUP);
  pinMode(ENCODER_DT,INPUT_PULLUP);
  pinMode(ENCODER_KEY,INPUT_PULLUP);
  pinMode(LED_BUILTIN,OUTPUT);
  lastCLK=digitalRead(ENCODER_CLK);
  audioBegin();
  Serial.println("Drum Controller Ready");
}

void loop(){
  int clk=digitalRead(ENCODER_CLK);
  if(clk!=lastCLK && clk==LOW){
    if(digitalRead(ENCODER_DT)!=clk) bpm+=5;
    else bpm-=5;
    if(bpm<40)bpm=40;
    if(bpm>240)bpm=240;
    Serial.printf("BPM: %d\n",bpm);
  }
  lastCLK=clk;

  bool key=digitalRead(ENCODER_KEY);
  if(lastKey==HIGH && key==LOW){
    playing=!playing;
    digitalWrite(LED_BUILTIN,playing?HIGH:LOW);
    Serial.println(playing?"DRUM START":"DRUM STOP");
  }
  lastKey=key;
  delay(5);
}
