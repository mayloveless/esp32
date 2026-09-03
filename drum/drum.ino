#include <Arduino.h>
#include <ESP_I2S.h>
#include <math.h>


/**
 * =====================
 * Pin Config
 * =====================
 */

// MAX98357A
#define I2S_BCLK 4
#define I2S_LRC  5
#define I2S_DIN  6


// EC11
#define ENCODER_CLK 7
#define ENCODER_DT  15
#define ENCODER_KEY 16


/**
 * =====================
 * Audio Engine
 * =====================
 */

class AudioEngine {

public:

  I2SClass i2s;

  void begin() {

    i2s.setPins(
      I2S_BCLK,
      I2S_LRC,
      I2S_DIN
    );


    bool result = i2s.begin(
      I2S_MODE_STD,
      32000,
      I2S_DATA_BIT_WIDTH_16BIT,
      I2S_SLOT_MODE_MONO
    );


    if(result) {
      Serial.println("Audio init OK");
    } else {
      Serial.println("Audio init FAILED");
    }

  }


  // 测试声音
  void playTone(
    float hz,
    int durationMs
  ){

    const int sampleRate = 32000;

    int totalSamples =
      sampleRate * durationMs / 1000;


    float phase = 0;

    float step =
      2 * PI * hz / sampleRate;


    int16_t buffer[128];


    for(
      int i = 0;
      i < totalSamples;
      i += 128
    ){

      for(
        int j = 0;
        j < 128;
        j++
      ){

        buffer[j] =
          sin(phase) * 5000;


        phase += step;

        if(phase > 2 * PI)
          phase -= 2 * PI;

      }


      i2s.write(
        (uint8_t*)buffer,
        sizeof(buffer)
      );

    }

  }


};


/**
 * =====================
 * Encoder
 * =====================
 */

class Encoder {

private:

  int lastCLK;


public:

  void begin(){

    pinMode(
      ENCODER_CLK,
      INPUT_PULLUP
    );

    pinMode(
      ENCODER_DT,
      INPUT_PULLUP
    );

    pinMode(
      ENCODER_KEY,
      INPUT_PULLUP
    );


    lastCLK =
      digitalRead(ENCODER_CLK);

  }


  void update(){

    int clk =
      digitalRead(ENCODER_CLK);


    if(
      clk != lastCLK &&
      clk == LOW
    ){

      if(
        digitalRead(ENCODER_DT)
        != clk
      ){
        Serial.println("Encoder RIGHT");
      }
      else{
        Serial.println("Encoder LEFT");
      }

    }


    lastCLK = clk;


    static bool lastKey = HIGH;

    bool key =
      digitalRead(ENCODER_KEY);


    if(
      lastKey == HIGH &&
      key == LOW
    ){

      Serial.println("Encoder CLICK");

    }


    lastKey = key;

  }

};



/**
 * =====================
 * App
 * =====================
 */

AudioEngine audio;

Encoder encoder;


void setup(){

  Serial.begin(115200);

  delay(1000);


  Serial.println(
    "Moyu Radio Prototype"
  );


  audio.begin();

  encoder.begin();


  Serial.println(
    "Ready"
  );


  // 第一次测试：
  // 启动后响一下
  audio.playTone(
    440,
    500
  );

}


void loop(){

  encoder.update();


  delay(5);

}