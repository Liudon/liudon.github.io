---
title: "2026 年对口型视频合成方案对比：Wav2Lip、VideoReTalking、 MuseTalk 部署与实测"
slug: "lip-sync-video-synthesis-comparison"
date: 2026-06-17T15:45:03+08:00
draft: false
description: "实测对比 Wav2Lip、VideoReTalking 和 MuseTalk 三种对口型视频合成方案，分析部署难度、推理速度、画面质量和适用场景。"
summary: "本文基于 AutoDL RTX 4090 环境，对 Wav2Lip、VideoReTalking 和 MuseTalk 三种对口型视频合成方案进行部署验证和效果对比，并补充 Wav2Lip 输出模糊时使用 GFPGAN 做面部增强的优化方法。"
tags: 
  - Wav2Lip
  - VideoReTalking
  - MuseTalk
  - Lip Sync
  - 对口型
  - AI视频
keywords:
  - Wav2Lip
  - VideoReTalking
  - MuseTalk
  - Lip Sync
  - 对口型
  - AI视频
  - 视频对口型
  - 口型同步
  - 数字人
  - 口播视频合成
  - AI口播
---

朋友有个口播视频合成的需求，这段时间做了些调研，核心是两个能力：音色克隆和对口型视频合成。

上一篇我们已经讲了音色克隆，今天我们来看一下对口型视频合成的实现。

## 方案总结

| 方案                     | 部署难度 | 推理速度                    | 画面质量         | 适合场景           |
| ---------------------- | ---- | ----------------------- | ------------ | -------------- |
| Wav2Lip / Easy-Wav2Lip | 中等   | Fast 模式最快，Enhanced 模式最慢 | 一般，嘴部和脸部容易模糊，可以引入 **GFPGAN** 进行后处理优化 | 快速验证、低成本批量测试   |
| Video-ReTalking        | 较高   | 中等偏慢                    | 较好，带人脸增强流程   | 高质量离线视频合成      |
| MuseTalk               | 较高   | 较快                      | 本次测试最好       | 数字人、实时或准实时口型驱动 |

从本次测试结果看，如果只是快速验证流程，Wav2Lip / Easy-Wav2Lip 成本最低；如果更重视最终观感，可以考虑 Video-ReTalking；如果希望在速度和效果之间取得更好的平衡，MuseTalk 是目前更推荐的方案。

## 部署验证

> 本次所有测试全部在[AutoDL](https://autodl.com/)平台进行。

测试机器规格如下：

```
GPU RTX 4090(24GB) * 1
CPU 16 vCPU Intel(R) Xeon(R) Platinum 8352V CPU @ 2.10GHz
内存 120GB
硬盘 系统盘:30 GB
    数据盘:免费:50GB SSD  付费:0GB
```

**省钱提示：**

> AutoDL有开机和无卡开机两种模式，无卡开机每小时0.1元，在环境部署阶段使用无卡开机模式，部署完成后再切换到正常开机模式测试。

### Wav2Lip

基于2020年的[A Lip Sync Expert Is All You Need for Speech to Lip Generation In the Wild](https://arxiv.org/abs/2008.10010)论文实现，最经典的对口型方案，项目资料多、社区使用经验丰富。

项目地址：
[https://github.com/Rudrabha/Wav2Lip](https://github.com/Rudrabha/Wav2Lip)

[https://github.com/anothermartz/Easy-Wav2Lip](https://github.com/anothermartz/Easy-Wav2Lip)

本次使用Easy-Wav2Lip进行部署验证。

#### 部署测试

1. 创建虚拟环境

```
conda create -n wav2lip python=3.10 -y
conda activate wav2lip
```

2. 克隆代码

```
git clone https://github.com/anothermartz/Easy-Wav2Lip.git
cd Easy-Wav2Lip
```

3. 安装依赖

```
pip install -r requirements.txt
```

4. 下载模型

```
python install.py
```

5. 合成测试

```
python inference.py \
    --checkpoint_path checkpoints/Wav2Lip.pth \
    --face input.mp4 \
    --audio input.wav \
    --outfile output.mp4 \
    --out_height 1608
```

默认合成的视频分辨率较低，可以通过 `--out_height` 指定输出视频高度，这里设置为原视频高度，以尽量保持输出分辨率。

实际耗时如下：

```
# 不指定--quality参数，默认为 Fast
real    0m23.950s
user    1m13.251s
sys     1m1.965s

# --quality Enhanced
real    13m55.324s
user    196m45.613s
sys     6m58.818s
```

支持三档质量模式：

| 模式 | 说明 | 速度 | 质量 |
|------|------|------|------|
| **Fast** | 原始 Wav2Lip | 最快 | 基础 |
| **Improved** | Wav2Lip + 嘴部羽化遮罩 | 快 | 较好，去除嘴部方块感 |
| **Enhanced** | Wav2Lip + 遮罩 + GFPGAN 超分辨率 | 较慢 | 最好，面部清晰度大幅提升 |

实际测试指定 **Improved** 或者 **Enhanced** 档质量，效果反而不如 **Fast**档；切换使用 **Wav2Lip_GAN.pth** 模型，效果也没有提升。

默认合成的视频嘴部模糊抖动，可以引入 **GFPGAN** 进行面部增强。

1. 安装 **GFPGAN**

```
git clone https://github.com/TencentARC/GFPGAN.git
cd GFPGAN
pip install -r requirements.txt
python setup.py develop
```

2. 拆帧

```
mkdir -p /tmp/wav2lip_frames /tmp/wav2lip_enhanced
ffmpeg -i output.mp4 /tmp/wav2lip_frames/%05d.png
```

3. GFPGAN 逐帧增强

```
python inference_gfpgan.py \
    -i /tmp/wav2lip_frames \
    -o /tmp/wav2lip_enhanced \
    -v 1.4 \
    -s 2 \
    --bg_upsampler none
```

4. 合回视频（保留原音频）

```
ffmpeg -framerate 25 -i /tmp/wav2lip_enhanced/restored_imgs/%05d.png \
    -i output.mp4 \
    -map 0:v -map 1:a \
    -c:v libx264 -crf 18 output_enhanced.mp4
```

5. 清理临时文件

```
rm -rf /tmp/wav2lip_frames /tmp/wav2lip_enhanced
```

### Video-ReTalking

基于2022年的[Audio-based Lip Synchronization for Talking Head Video Editing In the Wild](https://arxiv.org/abs/2211.14758)论文实现，由西安电子科技大学、腾讯 AI Lab、清华大学等机构提出的口型同步与表情编辑方案。

项目地址：

https://github.com/opentalker/video-retalking

#### 部署测试

1. 准备系统依赖

```bash
sudo apt update
sudo apt install -y git wget curl build-essential cmake ffmpeg
nvidia-smi
conda --version
```

2. 克隆项目

```bash
cd ~
git clone https://github.com/OpenTalker/video-retalking.git --recursive
cd video-retalking
```

3. 创建环境并安装依赖

```bash
conda create -n video_retalking python=3.8 -y
conda activate video_retalking

pip install torch==2.0.1 torchvision==0.15.2 torchaudio==2.0.2 \
    --index-url https://download.pytorch.org/whl/cu118

pip install -r requirements.txt
```

4. 下载权重

```bash
cd ~/video-retalking
mkdir -p checkpoints
cd checkpoints

BASE=https://github.com/vinthony/video_retalking/releases/download/v0.0.1

for f in \
  30_net_gen.pth \
  BFM.zip \
  DNet.pt \
  ENet.pth \
  expression.mat \
  face3d.pth \
  GFPGANv1.3.pth \
  GPEN-BFR-512.pth \
  LNet.pth \
  ParseNet-latest.pth \
  RetinaFace-R50.pth \
  shape_predictor_68_face_landmarks.dat
do
  wget -c "$BASE/$f"
done

unzip -o BFM.zip -d BFM
rm BFM.zip
```

权重总大小约 4GB。缺任何一个文件，都可能在加载 checkpoint 阶段报错。

5. 合成测试

```
python3 inference.py \
  --face input.mp4 \
  --audio input.wav \
  --outfile ./result.mp4
```

实际耗时如下：

```
real    6m13.248s
user    11m8.239s
sys     1m17.590s
```

### MuseTalk

基于2024年的[Real-Time High Quality Lip Synchronization with Latent Space Inpainting](https://arxiv.org/abs/2410.10122v2)论文实现，由腾讯音乐天琴实验室开源的实时高质量唇形同步模型。

它走潜在空间 inpainting 路线，v1.5 相比早期版本提升了清晰度和唇语同步效果。

项目地址：

https://github.com/TMElyralab/MuseTalk

#### 部署测试

1. 安装系统依赖

```
nvidia-smi
conda --version
sudo apt update
sudo apt install -y git ffmpeg build-essential
```

2. 创建环境

```
conda create -n musetalk python=3.10 -y
conda activate musetalk

pip install torch==2.0.1 torchvision==0.15.2 torchaudio==2.0.2 \
    --index-url https://download.pytorch.org/whl/cu118
```

3. 克隆项目并安装依赖

```
git clone https://github.com/TMElyralab/MuseTalk.git
cd MuseTalk

pip install -r requirements.txt
pip install --no-cache-dir -U openmim
mim install mmengine
mim install "mmcv==2.0.1"
mim install "mmdet==3.1.0"
mim install "mmpose==1.1.0"
pip install munkres json_tricks xtcocotools
```

4. 配置 FFmpeg

```
export FFMPEG_PATH=$(which ffmpeg)
echo 'export FFMPEG_PATH=$(which ffmpeg)' >> ~/.bashrc
source ~/.bashrc
```

5. 下载模型

```
export HF_ENDPOINT=https://hf-mirror.com # 国内网络可以先设置 HuggingFace 镜像
cd ~/MuseTalk

hf download TMElyralab/MuseTalk --local-dir models/
hf download stabilityai/sd-vae-ft-mse --local-dir models/sd-vae-ft-mse/
hf download openai/whisper-tiny --local-dir models/whisper/
hf download yzd-v/DWPose --include "dw-ll_ucoco_384.pth" --local-dir models/dwpose/
hf download ByteDance/LatentSync --include "latentsync_syncnet.pt" --local-dir models/syncnet/
hf download afrizalha/musetalk-models \
    --include "face-parse-bisent/79999_iter.pth" \
    --local-dir models/

wget https://download.pytorch.org/models/resnet18-5c106cde.pth \
    -O models/face-parse-bisent/resnet18-5c106cde.pth
```

模型目录大致应包含：

```text
models/
├── musetalk/
├── musetalkV15/
├── syncnet/
├── dwpose/
├── face-parse-bisent/
├── sd-vae-ft-mse/
└── whisper/
```

6. 合成测试

```
python -m scripts.inference \
    --inference_config configs/inference/my_task.yaml \
    --result_dir results/my_output \
    --unet_model_path models/musetalkV15/unet.pth \
    --unet_config models/musetalkV15/musetalk.json \
    --version v15 \
    --use_float16
```

输出文件会保存在 `results/my_output/`目录下。

实际耗时如下：

```
real    2m54.050s
user    8m12.693s
sys     0m59.808s
```


## 效果对比

### Wav2Lip

{{< video src="wav2lip.mp4" >}}

### Wav2Lip + GFPGAN面部增强

{{< video src="wav2lip_gfpgan.mp4" >}}

### Video-ReTalking

{{< video src="video-retalking.mp4" >}}

### MuseTalk

{{< video src="musetalk.mp4" >}}

基于本次测试素材来看，MuseTalk 的画面质量最优，Video-ReTalking次之，隐约看见嘴部抖动，Wav2Lip最差，抖动最明显，可以通过 **GFPGAN** 进行后处理优化。

从合成速度来看，从快到慢依次为：Wav2Lip Fast、MuseTalk、Video-ReTalking、Wav2Lip Enhanced。

## 结论

整体来看，MuseTalk 在本次测试中速度和效果都比较均衡，是三个方案里我目前最推荐继续深入尝试的方案。
