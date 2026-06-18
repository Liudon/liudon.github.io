---
title: "2026年 音色克隆方案对比：IndexTTS-2、CosyVoice、GPT-SoVITS、Fish Speech、VoxCPM 部署与实测"
slug: "voice-cloning-solution-comparison"
description: "系统对比 IndexTTS-2、CosyVoice、GPT-SoVITS、Fish Speech、VoxCPM 五大音色克隆方案，详解部署步骤、测试方法、硬件要求、CPU 支持、优缺点与选型建议。"
summary: "一篇讲清楚四套主流音色克隆方案部署、测试、硬件门槛和选型建议的实战文章。"
date: 2026-05-18T15:19:23+08:00
draft: false
tags: 
  - 音色克隆
  - voice-cloning
  - TTS
  - 语音合成
  - IndexTTS-2
  - CosyVoice
  - GPT-SoVITS
  - Fish Speech
  - VoxCPM
keywords:
  - 音色克隆
  - voice cloning
  - IndexTTS-2
  - CosyVoice
  - GPT-SoVITS
  - Fish Speech
  - VoxCPM
  - 零样本 TTS
  - few-shot TTS
  - TTS 方案对比
---

随着大模型和语音生成技术的发展，音色克隆（Voice Cloning） 已经成为当前 TTS 领域最受关注的方向之一。

无论是数字人、AI 配音、语音助手，还是内容生产和个性化交互，越来越多团队开始关注开源音色克隆方案在实际业务中的落地表现。

但真正进入部署和测试阶段后，问题往往并不只是“能不能出声音”，而是：哪套方案更容易部署，哪套方案语言混合更稳定，哪套方案的音色相似度更高。

本文将围绕 **IndexTTS-2**、**CosyVoice**、**GPT-SoVITS**、**Fish Speech**、**VoxCPM** 五套主流开源音色克隆方案，结合实际部署与测试过程，分析它们在部署复杂度、零样本效果、中英混合能力、服务化支持和后续训练价值上的差异，帮助你更快找到适合自己业务场景的方案。

```
2026年6月12日更新，添加VoxCPM方案。
```

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
>
> 来自亲身的血泪教训，IndexTTS部署的时候用的正常模式，小半天干下去几十块钱。 😭😭😭

源音频为我家娃读的一段音频，合成后音频文本内容为“Welcome to Beijing, President Trump.北京欢迎你，特朗普总统”。

### IndexTTS-2

项目地址：[https://github.com/index-tts/index-tts](https://github.com/index-tts/index-tts)

> Index-TTS2是一款突破性的自回归零样本文本转语音模型，专为精确时长控制而设计，这对于视频配音等应用至关重要。它实现了情感表达和说话者身份之间的解耦，从而能够独立控制音色和情感。该模型融合了GPT潜在表示，并具有基于文本描述的软指令机制，以增强情感控制。

#### 部署测试

1. 克隆代码

```
git lfs install
git clone https://github.com/index-tts/index-tts.git
cd index-tts
git lfs pull
```

2. 安装依赖

```
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.bashrc

uv sync --all-extras
# 国内可换镜像
# uv sync --all-extras --default-index "https://mirrors.aliyun.com/pypi/simple"
```

3. 下载模型

方式一：huggingface

```
# 国内可设置HF镜像
# export HF_ENDPOINT="https://hf-mirror.com"
uv tool install "huggingface-hub[cli,hf_xet]"
hf download IndexTeam/IndexTTS-2 --local-dir=checkpoints
```

方式二：modelscope

```
uv tool install "modelscope"
modelscope download --model IndexTeam/IndexTTS-2 --local_dir checkpoints
```

4. 环境检测

```
uv run tools/gpu_check.py
Scanning for PyTorch hardware acceleration devices...

...
Hardware acceleration detected. Your system is ready!
```

看到这个表示环境已经部署好了，可以开始合成测试了。

5. 合成测试

修改项目默认的inter_v2.py文件代码：

- 将834行`prompt_wav = "examples/voice_01.wav"`中的文件路径改为实际测试音频文件路径。
  
- 将835行`text = '欢迎大家来体验indextts2，并给予我们意见与反馈，谢谢大家。'`中的内容改为你自定义的文本。
  
- 将842行`tts.infer(spk_audio_prompt=prompt_wav, text=text, output_path="gen.wav", verbose=True)`下面的代码全部删掉。

执行合成脚本：

```
PYTHONPATH="$PYTHONPATH:." uv run indextts/infer_v2.py
```

合成耗时在**2min+**，合成后的音频效果：

{{< audio src="indextts.wav" >}}

我把这段合成音频发给我老婆后，她在第一时间并没有察觉这是 AI 生成的。对于零样本合成来说，这个效果是非常好了。

#### 问题整理

1. LFS拉取失败，报错信息如下：

```
git lfs pull
Error updating the Git index: (0/1), 0 B | 0 B/s
error: indextts/BigVGAN/__init__.py: cannot add to the index - missing --add option?
fatal: Unable to process path indextts/BigVGAN/__init__.py


Errors logged to '/root/index-tts/.git/lfs/logs/20260513T105919.131495169.log'.
Use git lfs logs last to view the log.
batch response: This repository exceeded its LFS budget. The account responsible for the budget should increase it to restore access.
Failed to fetch some objects from 'https://github.com/index-tts/index-tts.git/info/lfs'
```

执行下面命令替代第一步的命令。

```
rm -rf index-tts
GIT_LFS_SKIP_SMUDGE=1 git clone https://github.com/index-tts/index-tts.git
cd index-tts
```

2. 合成测试报错

- OSError: We couldn't connect to 'https://hf-mirror.com' to load the files, and couldn't find them in the cached files.

具体报错信息如下：

```
PYTHONPATH="$PYTHONPATH:." uv run indextts/infer_v2.py
>> GPT weights restored from: checkpoints/gpt.pth
GPT2InferenceModel has generative capabilities, as `prepare_inputs_for_generation` is explicitly overwritten. However, it doesn't directly inherit from `GenerationMixin`. From 👉v4.50👈 onwards, `PreTrainedModel` will NOT inherit from `GenerationMixin`, and this model will lose the ability to call `generate` and other related functions.
  - If you're using `trust_remote_code=True`, you can get rid of this warning by loading the model with an auto class. See https://huggingface.co/docs/transformers/en/model_doc/auto#auto-classes
  - If you are the owner of the model architecture code, please modify your model class such that it inherits from `GenerationMixin` (after `PreTrainedModel`, otherwise you'll get an exception).
  - If you are not the owner of the model architecture class, please contact the model code owner to update it.
Traceback (most recent call last):
  File "/Users/liudon/index-tts/.venv/lib/python3.10/site-packages/huggingface_hub/file_download.py", line 1568, in _get_metadata_or_catch_error
    raise FileMetadataError(
huggingface_hub.errors.FileMetadataError: Distant resource does not seem to be on huggingface.co. It is possible that a configuration issue prevents you from downloading resources from https://huggingface.co. Please check your firewall and proxy settings and make sure your SSL certificates are updated.

The above exception was the direct cause of the following exception:

Traceback (most recent call last):
  File "/Users/liudon/index-tts/.venv/lib/python3.10/site-packages/transformers/utils/hub.py", line 470, in cached_files
    hf_hub_download(
  File "/Users/liudon/index-tts/.venv/lib/python3.10/site-packages/huggingface_hub/utils/_validators.py", line 114, in _inner_fn
    return fn(*args, **kwargs)
  File "/Users/liudon/index-tts/.venv/lib/python3.10/site-packages/huggingface_hub/file_download.py", line 1010, in hf_hub_download
    return _hf_hub_download_to_cache_dir(
  File "/Users/liudon/index-tts/.venv/lib/python3.10/site-packages/huggingface_hub/file_download.py", line 1117, in _hf_hub_download_to_cache_dir
    _raise_on_head_call_error(head_call_error, force_download, local_files_only)
  File "/Users/liudon/index-tts/.venv/lib/python3.10/site-packages/huggingface_hub/file_download.py", line 1661, in _raise_on_head_call_error
    raise LocalEntryNotFoundError(
huggingface_hub.errors.LocalEntryNotFoundError: An error happened while trying to locate the file on the Hub and we cannot find the requested files in the local cache. Please check your connection and try again or make sure your Internet connection is on.

The above exception was the direct cause of the following exception:

Traceback (most recent call last):
  File "/Users/liudon/index-tts/indextts/infer_v2.py", line 836, in <module>
    tts = IndexTTS2(
  File "/Users/liudon/index-tts/indextts/infer_v2.py", line 115, in __init__
    self.extract_features = SeamlessM4TFeatureExtractor.from_pretrained("facebook/w2v-bert-2.0")
  File "/Users/liudon/index-tts/.venv/lib/python3.10/site-packages/transformers/feature_extraction_utils.py", line 384, in from_pretrained
    feature_extractor_dict, kwargs = cls.get_feature_extractor_dict(pretrained_model_name_or_path, **kwargs)
  File "/Users/liudon/index-tts/.venv/lib/python3.10/site-packages/transformers/feature_extraction_utils.py", line 510, in get_feature_extractor_dict
    resolved_feature_extractor_file = cached_file(
  File "/Users/liudon/index-tts/.venv/lib/python3.10/site-packages/transformers/utils/hub.py", line 312, in cached_file
    file = cached_files(path_or_repo_id=path_or_repo_id, filenames=[filename], **kwargs)
  File "/Users/liudon/index-tts/.venv/lib/python3.10/site-packages/transformers/utils/hub.py", line 543, in cached_files
    raise OSError(
OSError: We couldn't connect to 'https://hf-mirror.com' to load the files, and couldn't find them in the cached files.
Checkout your internet connection or see how to run the library in offline mode at 'https://huggingface.co/docs/transformers/installation#offline-mode'.
```

这个是因为我们前面设置的`export HF_ENDPOINT="https://hf-mirror.com"`环境变量导致的，删除这个环境变量即可。

```
unset HF_ENDPOINT
```

重新执行，会从huggingface下载其他模型，因为国内网络问题，预计在1小时左右。


- OSError: Can't load the model for 'facebook/w2v-bert-2.0'. If you were trying to load it from 'https://huggingface.co/models', make sure you don't have a local directory with the same name. Otherwise, make sure 'facebook/w2v-bert-2.0' is the correct path to a directory containing a file named pytorch_model.bin, tf_model.h5, model.ckpt or flax_model.msgpack.

完整报错信息如下：

```
PYTHONPATH="$PYTHONPATH:." uv run indextts/infer_v2.py
>> GPT weights restored from: checkpoints/gpt.pth
GPT2InferenceModel has generative capabilities, as `prepare_inputs_for_generation` is explicitly overwritten. However, it doesn't directly inherit from `GenerationMixin`. From 👉v4.50👈 onwards, `PreTrainedModel` will NOT inherit from `GenerationMixin`, and this model will lose the ability to call `generate` and other related functions.
  - If you're using `trust_remote_code=True`, you can get rid of this warning by loading the model with an auto class. See https://huggingface.co/docs/transformers/en/model_doc/auto#auto-classes
  - If you are the owner of the model architecture code, please modify your model class such that it inherits from `GenerationMixin` (after `PreTrainedModel`, otherwise you'll get an exception).
  - If you are not the owner of the model architecture class, please contact the model code owner to update it.
Traceback (most recent call last):
  File "/Users/liudon/index-tts/indextts/infer_v2.py", line 836, in <module>
    tts = IndexTTS2(
  File "/Users/liudon/index-tts/indextts/infer_v2.py", line 116, in __init__
    self.semantic_model, self.semantic_mean, self.semantic_std = build_semantic_model(
  File "/Users/liudon/index-tts/indextts/utils/maskgct_utils.py", line 88, in build_semantic_model
    semantic_model = Wav2Vec2BertModel.from_pretrained("facebook/w2v-bert-2.0")
  File "/Users/liudon/index-tts/.venv/lib/python3.10/site-packages/transformers/modeling_utils.py", line 308, in _wrapper
    return func(*args, **kwargs)
  File "/Users/liudon/index-tts/.venv/lib/python3.10/site-packages/transformers/modeling_utils.py", line 4461, in from_pretrained
    checkpoint_files, sharded_metadata = _get_resolved_checkpoint_files(
  File "/Users/liudon/index-tts/.venv/lib/python3.10/site-packages/transformers/modeling_utils.py", line 1125, in _get_resolved_checkpoint_files
    raise EnvironmentError(
OSError: facebook/w2v-bert-2.0 does not appear to have a file named pytorch_model.bin, model.safetensors, tf_model.h5, model.ckpt or flax_model.msgpack.
```

还是因为网络问题，执行下面命令手动下载模型。

```
hf download facebook/w2v-bert-2.0
hf download amphion/MaskGCT semantic_codec/model.safetensors
hf download funasr/campplus
hf download nvidia/bigvgan_v2_22khz_80band_256x bigvgan_generator.pt config.json
hf download Plachta/JDCnet bst.t7
```

### CosyVoice

项目地址：[https://github.com/FunAudioLLM/CosyVoice](https://github.com/FunAudioLLM/CosyVoice)

> CosyVoice 3.0 是一款基于大型语言模型 (LLM) 的高级文本转语音 (TTS) 系统，在内容一致性、说话人相似度和韵律自然度方面均超越了其前代产品 (CosyVoice 2.0)。它专为实际环境中的零样本多语言语音合成而设计。

本次测试选用CosyVoice3-0.5B这个模型。

#### 部署测试

1. 克隆代码

```
git clone --recursive https://github.com/FunAudioLLM/CosyVoice.git
# If you failed to clone the submodule due to network failures, please run the following command until success
cd CosyVoice
git submodule update --init --recursive
```

2. Create Conda env

```
conda create -n cosyvoice -y python=3.10
conda activate cosyvoice
pip install -r requirements.txt -i https://mirrors.aliyun.com/pypi/simple/ --trusted-host=mirrors.aliyun.com
```

3. 下载模型

执行下面python代码。

```
from modelscope import snapshot_download
snapshot_download('FunAudioLLM/Fun-CosyVoice3-0.5B-2512', local_dir='pretrained_models/Fun-CosyVoice3-0.5B')
snapshot_download('iic/CosyVoice-ttsfrd', local_dir='pretrained_models/CosyVoice-ttsfrd')
```

4. 合成测试

新建测试文件demo_example.py，内容如下：

```
import sys
sys.path.append('third_party/Matcha-TTS')
from cosyvoice.cli.cosyvoice import AutoModel
import torchaudio

def main():
    """ CosyVoice3 Usage, check https://funaudiollm.github.io/cosyvoice3/ for more details
    """
    cosyvoice = AutoModel(model_dir='pretrained_models/Fun-CosyVoice3-0.5B')
    text = 'You are a helpful assistant.<|endofprompt|>Welcome to Beijing, President Trump. 北京欢迎你，特朗普总统。'
    for i, j in enumerate(cosyvoice.inference_cross_lingual(text, './child.wav', stream=False, speed=1.2)):
        torchaudio.save(f'cross_lingual_{i}.wav', j['tts_speech'], cosyvoice.sample_rate)

if __name__ == '__main__':
    main()
```

执行测试脚本。

```
python demo_example.py
```

合成耗时在**24秒**，合成后的音频效果：

{{< audio src="cosyvoice.wav" >}}

#### 问题整理

1. openai-whisper安装失败No module named 'pkg_resources' 

参考https://github.com/FunAudioLLM/CosyVoice/issues/1844

创建文件build-constraints.txt，写入以下内容：

```
setuptools>=45,<80
```

运行命令

```
pip install --build-constraint build-constraints.txt -r requirements.txt
```

### GPT-SoVITS

项目地址：[https://github.com/RVC-Boss/GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS)

> 强大的少样本语音转换与语音合成Web用户界面.

#### 部署测试

1. 克隆代码

```
git clone https://github.com/RVC-Boss/GPT-SoVITS.git
cd GPT-SoVITS
```

2. Create Conda env

```
conda create -n GPTSoVits python=3.10
conda activate GPTSoVits
```

3. 下载模型

```
bash install.sh --device CU128 --source HF-Mirror
```

4. 启动API服务

```
python api_v2.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS/configs/tts_infer.yaml
```

5. 合成测试

```
curl "http://127.0.0.1:9880/tts?text=你好，欢迎测试音色克隆&text_lang=zh&ref_audio_path=ref.wav&prompt_lang=zh&prompt_text=这是一段参考音频"
```

参数说明：

- text：合成音频的文本内容
- text_lang：合成音频语言
- ref_audio_path：参考音频文件路径
- prompt_lang：参考音频语言
- prompt_text：参考音频文本内容，需要与实际音频内容一致，否则会导致合成音频内容错误

合成耗时在**10s**内，合成后的音频效果：

{{< audio src="GPT-SoVITS.wav" >}}

#### 问题整理

1. Reference audio is outside the 3-10 second range, please choose another one!

参考音频时长限制为3-10秒，使用ffmpeg对音频进行切片。

```
ffmpeg -i child.wav -t 10 -ar 32000 -ac 1 child_10s.wav
```

2. Exception":"Could not load libtorchcodec.

完整报错信息如下：

```
{"message":"tts failed","Exception":"Could not load libtorchcodec. Likely causes:\n          1. FFmpeg is not properly installed in your environment. We support\n             versions 4, 5, 6, 7, and 8, and we attempt to load libtorchcodec\n             for each of those versions. Errors for versions not installed on\n             your system are expected; only the error for your installed FFmpeg\n             version is relevant. On Windows, ensure you've installed the\n             \"full-shared\" version which ships DLLs.\n          2. The PyTorch version (2.11.0+cu128) is not compatible with\n             this version of TorchCodec. Refer to the version compatibility\n             table:\n             https://github.com/pytorch/torchcodec?tab=readme-ov-file#installing-torchcodec.\n          3. Another runtime dependency; see exceptions below.\n\n        The following exceptions were raised as we tried to load libtorchcodec:\n        \n[start of libtorchcodec loading traceback]\nFFmpeg version 8:\nTraceback (most recent call last):\n  File \"/root/miniconda3/envs/GPTSoVits/lib/python3.10/site-packages/torch/_ops.py\", line 1503, in load_library\n    ctypes.CDLL(path)\n  File \"/root/miniconda3/envs/GPTSoVits/lib/python3.10/ctypes/__init__.py\", line 374, in __init__\n    self._handle = _dlopen(self._name, mode)\nOSError: libnppicc.so.12: cannot open shared object file: No such file or directory\n\nThe above exception was the direct cause of the following exception:\n\nTraceback (most recent call last):\n  File \"/root/miniconda3/envs/GPTSoVits/lib/python3.10/site-packages/torchcodec/_internally_replaced_utils.py\", line 93, in load_torchcodec_shared_libraries\n    torch.ops.load_library(core_library_path)\n  File \"/root/miniconda3/envs/GPTSoVits/lib/python3.10/site-packages/torch/_ops.py\", line 1505, in load_library\n    raise OSError(f\"Could not load this library: {path}\") from e\nOSError: Could not load this library: /root/miniconda3/envs/GPTSoVits/lib/python3.10/site-packages/torchcodec/libtorchcodec_core8.so\n\nFFmpeg version 7:\nTraceback (most recent call last):\n  File \"/root/miniconda3/envs/GPTSoVits/lib/python3.10/site-packages/torch/_ops.py\", line 1503, in load_library\n    ctypes.CDLL(path)\n  File \"/root/miniconda3/envs/GPTSoVits/lib/python3.10/ctypes/__init__.py\", line 374, in __init__\n    self._handle = _dlopen(self._name, mode)\nOSError: libnppicc.so.12: cannot open shared object file: No such file or directory\n\nThe above exception was the direct cause of the following exception:\n\nTraceback (most recent call last):\n  File \"/root/miniconda3/envs/GPTSoVits/lib/python3.10/site-packages/torchcodec/_internally_replaced_utils.py\", line 93, in load_torchcodec_shared_libraries\n    torch.ops.load_library(core_library_path)\n  File \"/root/miniconda3/envs/GPTSoVits/lib/python3.10/site-packages/torch/_ops.py\", line 1505, in load_library\n    raise OSError(f\"Could not load this library: {path}\") from e\nOSError: Could not load this library: /root/miniconda3/envs/GPTSoVits/lib/python3.10/site-packages/torchcodec/libtorchcodec_core7.so\n\nFFmpeg version 6:\nTraceback (most recent call last):\n  File \"/root/miniconda3/envs/GPTSoVits/lib/python3.10/site-packages/torch/_ops.py\", line 1503, in load_library\n    ctypes.CDLL(path)\n  File \"/root/miniconda3/envs/GPTSoVits/lib/python3.10/ctypes/__init__.py\", line 374, in __init__\n    self._handle = _dlopen(self._name, mode)\nOSError: libnppicc.so.12: cannot open shared object file: No such file or directory\n\nThe above exception was the direct cause of the following exception:\n\nTraceback (most recent call last):\n  File \"/root/miniconda3/envs/GPTSoVits/lib/python3.10/site-packages/torchcodec/_internally_replaced_utils.py\", line 93, in load_torchcodec_shared_libraries\n    torch.ops.load_library(core_library_path)\n  File \"/root/miniconda3/envs/GPTSoVits/lib/python3.10/site-packages/torch/_ops.py\", line 1505, in load_library\n    raise OSError(f\"Could not load this library: {path}\") from e\nOSError: Could not load this library: /root/miniconda3/envs/GPTSoVits/lib/python3.10/site-packages/torchcodec/libtorchcodec_core6.so\n\nFFmpeg version 5:\nTraceback (most recent call last):\n  File \"/root/miniconda3/envs/GPTSoVits/lib/python3.10/site-packages/torch/_ops.py\", line 1503, in load_library\n    ctypes.CDLL(path)\n  File \"/root/miniconda3/envs/GPTSoVits/lib/python3.10/ctypes/__init__.py\", line 374, in __init__\n    self._handle = _dlopen(self._name, mode)\nOSError: libnppicc.so.12: cannot open shared object file: No such file or directory\n\nThe above exception was the direct cause of the following exception:\n\nTraceback (most recent call last):\n  File \"/root/miniconda3/envs/GPTSoVits/lib/python3.10/site-packages/torchcodec/_internally_replaced_utils.py\", line 93, in load_torchcodec_shared_libraries\n    torch.ops.load_library(core_library_path)\n  File \"/root/miniconda3/envs/GPTSoVits/lib/python3.10/site-packages/torch/_ops.py\", line 1505, in load_library\n    raise OSError(f\"Could not load this library: {path}\") from e\nOSError: Could not load this library: /root/miniconda3/envs/GPTSoVits/lib/python3.10/site-packages/torchcodec/libtorchcodec_core5.so\n\nFFmpeg version 4:\nTraceback (most recent call last):\n  File \"/root/miniconda3/envs/GPTSoVits/lib/python3.10/site-packages/torch/_ops.py\", line 1503, in load_library\n    ctypes.CDLL(path)\n  File \"/root/miniconda3/envs/GPTSoVits/lib/python3.10/ctypes/__init__.py\", line 374, in __init__\n    self._handle = _dlopen(self._name, mode)\nOSError: libnppicc.so.12: cannot open shared object file: No such file or directory\n\nThe above exception was the direct cause of the following exception:\n\nTraceback (most recent call last):\n  File \"/root/miniconda3/envs/GPTSoVits/lib/python3.10/site-packages/torchcodec/_internally_replaced_utils.py\", line 93, in load_torchcodec_shared_libraries\n    torch.ops.load_library(core_library_path)\n  File \"/root/miniconda3/envs/GPTSoVits/lib/python3.10/site-packages/torch/_ops.py\", line 1505, in load_library\n    raise OSError(f\"Could not load this library: {path}\") from e\nOSError: Could not load this library: /root/miniconda3/envs/GPTSoVits/lib/python3.10/site-packages/torchcodec/libtorchcodec_core4.so\n[end of libtorchcodec loading traceback]."}
```

- 解决torchcodec版本错误

```
(GPTSoVits) root@autodl-container-1421458302-fdce35d0:~/autodl-tmp/GPT-SoVITS# python -m pip show torchcodec
Name: torchcodec
Version: 0.11.1+cu128
Summary: A video decoder for PyTorch
Home-page:
Author:
Author-email: PyTorch Team <packages@pytorch.org>
License: BSD 3-Clause License

        Copyright 2024 Meta

        Redistribution and use in source and binary forms, with or without modification,
        are permitted provided that the following conditions are met:

        1. Redistributions of source code must retain the above copyright notice,this list
        of conditions and the following disclaimer.

        2. Redistributions in binary form must reproduce the above copyright notice, this
        list of conditions and the following disclaimer in the documentation
        and/or other materials provided with the distribution.

        3. Neither the name of the copyright holder nor the names of its contributors may
        be used to endorse or promote products derived from this software without specific
        prior written permission.

        THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS “AS IS” AND ANY
        EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
        OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT
        SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
        INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
        TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR
        BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
        CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN
        ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH
        DAMAGE.

Location: /root/miniconda3/envs/GPTSoVits/lib/python3.10/site-packages
Requires:
Required-by:
(GPTSoVits) root@autodl-container-1421458302-fdce35d0:~/autodl-tmp/GPT-SoVITS#
(GPTSoVits) root@autodl-container-1421458302-fdce35d0:~/autodl-tmp/GPT-SoVITS#
(GPTSoVits) root@autodl-container-1421458302-fdce35d0:~/autodl-tmp/GPT-SoVITS# python -m pip uninstall -y torchcodec
Found existing installation: torchcodec 0.11.1+cu128
Uninstalling torchcodec-0.11.1+cu128:
  Successfully uninstalled torchcodec-0.11.1+cu128
WARNING: Running pip as the 'root' user can result in broken permissions and conflicting behaviour with the system package manager, possibly rendering your system unusable. It is recommended to use a virtual environment instead: https://pip.pypa.io/warnings/venv. Use the --root-user-action option if you know what you are doing and want to suppress this warning.
(GPTSoVits) root@autodl-container-1421458302-fdce35d0:~/autodl-tmp/GPT-SoVITS#
(GPTSoVits) root@autodl-container-1421458302-fdce35d0:~/autodl-tmp/GPT-SoVITS#
(GPTSoVits) root@autodl-container-1421458302-fdce35d0:~/autodl-tmp/GPT-SoVITS# python -m pip install --no-cache-dir --force-reinstall \
>   --index-url https://download.pytorch.org/whl/cpu \
>   torchcodec==0.11.1
Looking in indexes: https://download.pytorch.org/whl/cpu
Collecting torchcodec==0.11.1
  Downloading https://download.pytorch.org/whl/cpu/torchcodec-0.11.1%2Bcpu-cp310-cp310-manylinux_2_28_x86_64.whl.metadata (11 kB)
Downloading https://download.pytorch.org/whl/cpu/torchcodec-0.11.1%2Bcpu-cp310-cp310-manylinux_2_28_x86_64.whl (2.3 MB)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 2.3/2.3 MB 3.2 MB/s  0:00:01
Installing collected packages: torchcodec
Successfully installed torchcodec-0.11.1+cpu
WARNING: Running pip as the 'root' user can result in broken permissions and conflicting behaviour with the system package manager, possibly rendering your system unusable. It is recommended to use a virtual environment instead: https://pip.pypa.io/warnings/venv. Use the --root-user-action option if you know what you are doing and want to suppress this warning.
(GPTSoVits) root@autodl-container-1421458302-fdce35d0:~/autodl-tmp/GPT-SoVITS#
(GPTSoVits) root@autodl-container-1421458302-fdce35d0:~/autodl-tmp/GPT-SoVITS#
(GPTSoVits) root@autodl-container-1421458302-fdce35d0:~/autodl-tmp/GPT-SoVITS# python -m pip show torchcodec
Name: torchcodec
Version: 0.11.1+cpu
Summary: A video decoder for PyTorch
Home-page:
Author:
Author-email: PyTorch Team <packages@pytorch.org>
License: BSD 3-Clause License

        Copyright 2024 Meta

        Redistribution and use in source and binary forms, with or without modification,
        are permitted provided that the following conditions are met:

        1. Redistributions of source code must retain the above copyright notice,this list
        of conditions and the following disclaimer.

        2. Redistributions in binary form must reproduce the above copyright notice, this
        list of conditions and the following disclaimer in the documentation
        and/or other materials provided with the distribution.

        3. Neither the name of the copyright holder nor the names of its contributors may
        be used to endorse or promote products derived from this software without specific
        prior written permission.

        THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS “AS IS” AND ANY
        EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
        OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT
        SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
        INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
        TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR
        BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
        CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN
        ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH
        DAMAGE.

Location: /root/miniconda3/envs/GPTSoVits/lib/python3.10/site-packages
Requires:
Required-by:
(GPTSoVits) root@autodl-container-1421458302-fdce35d0:~/autodl-tmp/GPT-SoVITS#
```

- 解决ffmpeg错误

```
(GPTSoVits) root@autodl-container-1421458302-fdce35d0:~/autodl-tmp/GPT-SoVITS# ffmpeg -version
ffmpeg version 8.0.1 Copyright (c) 2000-2025 the FFmpeg developers
built with gcc 14.3.0 (GCC)
configuration: --prefix=/home/task_177790567462050/croot/ffmpeg_1777905727578/_h_env_placehold_placehold_placehold_placehold_placehold_placehold_placehold_placehold_placehold_placehold_placehold_placehold_placehold_placehold_placehold_placehold_placehold_placehold_placehold_plac --cc=/home/task_177790567462050/croot/ffmpeg_1777905727578/_build_env/bin/x86_64-conda-linux-gnu-cc --cxx=/home/task_177790567462050/croot/ffmpeg_1777905727578/_build_env/bin/x86_64-conda-linux-gnu-c++ --nm=/home/task_177790567462050/croot/ffmpeg_1777905727578/_build_env/bin/x86_64-conda-linux-gnu-nm --ar=/home/task_177790567462050/croot/ffmpeg_1777905727578/_build_env/bin/x86_64-conda-linux-gnu-ar --enable-openssl --enable-demuxer=dash --enable-hardcoded-tables --enable-libfreetype --enable-libharfbuzz --enable-libfontconfig --enable-libopenh264 --enable-libdav1d --enable-libmp3lame --enable-libaom --enable-libsvtav1 --enable-libxml2 --enable-pic --enable-shared --enable-version3 --enable-zlib --enable-libvorbis --enable-libopus --enable-libwebp --enable-libshaderc --disable-ffplay --disable-static --disable-gpl --disable-doc --pkg-config=/home/task_177790567462050/croot/ffmpeg_1777905727578/_build_env/bin/pkg-config --arch=x86_64 --target-os=linux --cross-prefix=x86_64-conda-linux-gnu- --host-cc=/home/task_177790567462050/croot/ffmpeg_1777905727578/_build_env/bin/x86_64-conda-linux-gnu-cc --disable-gnutls --enable-libvpx --enable-pthreads --enable-alsa --enable-libpulse --enable-libdrm --enable-libvpl --enable-vaapi --enable-libtesseract --enable-libvpx --enable-libass --enable-librsvg
libavutil      60.  8.100 / 60.  8.100
libavcodec     62. 11.100 / 62. 11.100
libavformat    62.  3.100 / 62.  3.100
libavdevice    62.  1.100 / 62.  1.100
libavfilter    11.  4.100 / 11.  4.100
libswscale      9.  1.100 /  9.  1.100
libswresample   6.  1.100 /  6.  1.100

Exiting with exit code 0
(GPTSoVits) root@autodl-container-1421458302-fdce35d0:~/autodl-tmp/GPT-SoVITS#
(GPTSoVits) root@autodl-container-1421458302-fdce35d0:~/autodl-tmp/GPT-SoVITS#
(GPTSoVits) root@autodl-container-1421458302-fdce35d0:~/autodl-tmp/GPT-SoVITS# ls $CONDA_PREFIX/lib/libavutil.so*
/root/miniconda3/envs/GPTSoVits/lib/libavutil.so  /root/miniconda3/envs/GPTSoVits/lib/libavutil.so.60  /root/miniconda3/envs/GPTSoVits/lib/libavutil.so.60.8.100
(GPTSoVits) root@autodl-container-1421458302-fdce35d0:~/autodl-tmp/GPT-SoVITS# ls $CONDA_PREFIX/lib/libavcodec.so*
/root/miniconda3/envs/GPTSoVits/lib/libavcodec.so  /root/miniconda3/envs/GPTSoVits/lib/libavcodec.so.62  /root/miniconda3/envs/GPTSoVits/lib/libavcodec.so.62.11.100
(GPTSoVits) root@autodl-container-1421458302-fdce35d0:~/autodl-tmp/GPT-SoVITS# ls $CONDA_PREFIX/lib/libavformat.so*
/root/miniconda3/envs/GPTSoVits/lib/libavformat.so  /root/miniconda3/envs/GPTSoVits/lib/libavformat.so.62  /root/miniconda3/envs/GPTSoVits/lib/libavformat.so.62.3.100
(GPTSoVits) root@autodl-container-1421458302-fdce35d0:~/autodl-tmp/GPT-SoVITS# ls $CONDA_PREFIX/lib/libstdc++.so*
/root/miniconda3/envs/GPTSoVits/lib/libstdc++.so  /root/miniconda3/envs/GPTSoVits/lib/libstdc++.so.6  /root/miniconda3/envs/GPTSoVits/lib/libstdc++.so.6.0.34
(GPTSoVits) root@autodl-container-1421458302-fdce35d0:~/autodl-tmp/GPT-SoVITS#
(GPTSoVits) root@autodl-container-1421458302-fdce35d0:~/autodl-tmp/GPT-SoVITS# echo $LD_LIBRARY_PATH

(GPTSoVits) root@autodl-container-1421458302-fdce35d0:~/autodl-tmp/GPT-SoVITS#
(GPTSoVits) root@autodl-container-1421458302-fdce35d0:~/autodl-tmp/GPT-SoVITS# export LD_LIBRARY_PATH="$CONDA_PREFIX/lib:$LD_LIBRARY_PATH"
(GPTSoVits) root@autodl-container-1421458302-fdce35d0:~/autodl-tmp/GPT-SoVITS#
(GPTSoVits) root@autodl-container-1421458302-fdce35d0:~/autodl-tmp/GPT-SoVITS# echo $LD_LIBRARY_PATH
/root/miniconda3/envs/GPTSoVits/lib:
(GPTSoVits) root@autodl-container-1421458302-fdce35d0:~/autodl-tmp/GPT-SoVITS#
```

### Fish Speech

项目地址：[https://github.com/fishaudio/fish-speech](https://github.com/fishaudio/fish-speech)

> Fish Audio S2 Pro 是 Fish Audio 开发的最先进的多模态模型。S2 Pro 训练自超过 1000 万小时 的海量音频数据，覆盖全球 80 多种语言。通过创新的 双自回归 (Dual-AR) 架构与强化学习 (RL) 对齐技术，S2 Pro 能生成极具自然感、真实感且情感饱满的语音，在开源与闭源竞争中均处于领先地位。

#### 部署测试

1. 安装系统依赖

```
apt-get update
apt install portaudio19-dev libsox-dev ffmpeg
```

2. 克隆代码

```
git clone https://github.com/fishaudio/fish-speech.git
cd fish-speech
```

3. Create Conda env

```
conda create -n fish-speech python=3.12 -y
conda activate fish-speech
```

4. 安装依赖

```
pip install -e .[cu128]
```

5. 下载模型

```
# 国内可以配置这个镜像
# export HF_ENDPOINT="https://hf-mirror.com"

hf download fishaudio/s2-pro --local-dir checkpoints/s2-pro
```

6. 合成测试

- 方式一：命令行

```
python fish_speech/models/dac/inference.py \
  -i "test.wav" \
  --checkpoint-path "checkpoints/s2-pro/codec.pth"

# test.wav为参考音频，执行后会得到fake.npy和fake.wav两个文件。

python fish_speech/models/text2semantic/inference.py \
  --text "这是要合成的目标文本" \
  --prompt-text "这里填写参考音频对应的真实文本" \
  --prompt-tokens "fake.npy"

# 执行后，在output目录下会生成codes_0.npy文件。

python fish_speech/models/dac/inference.py \
  -i "./output/codes_0.npy" \
  --checkpoint-path "checkpoints/s2-pro/codec.pth"

# 最终得到合成后的fake.wav文件。
```

- 方式二：API调用

启动API服务

```
python tools/api_server.py \
  --llama-checkpoint-path checkpoints/s2-pro \
  --decoder-checkpoint-path checkpoints/s2-pro/codec.pth \
  --listen 0.0.0.0:8080
```

调用API触发音频合成

```
python tools/api_client.py \
  --url http://127.0.0.1:8080/v1/tts \
  --reference_audio "参考音频文件路径" \
  --reference_text "参考音频的文本内容" \
  --text "合成音频的文本内容"
  --no-play
```

合成的音频文件默认为generated_audio.wav文件。

命令行合成耗时在**1min+**，API合成耗时在**30s+**，合成后的音频效果：

{{< audio src="fish-speech.wav" >}}

#### 问题整理

1. fatal error: portaudio.h: No such file or directory

```
conda install -y -c conda-forge portaudio

装完后先验证头文件是否存在：

find $CONDA_PREFIX -name portaudio.h

再重试安装：

pip install -e .[cu128]
```

2. python tools/api_client.py报错“OSError: [Errno -9996] Invalid output device (no default output device)”

增加--no-play参数即可。

### VoxCPM

项目地址：[https://github.com/OpenBMB/VoxCPM](https://github.com/OpenBMB/VoxCPM)

#### 部署测试

1. 安装服务

```
pip install voxcpm
```

2. 合成测试

```
voxcpm clone \
    --text "This is a cloned voice sample." \
    --reference-audio path/to/voice.wav \
    --output out.wav
```

使用命令行方式，`--text`为克隆后的音频内容，`--reference-audio`为参考音频，`--output`为生成后的音频文件。

第一次执行需要下载模型，会慢一些，合成耗时在**7s**左右，合成后的音频效果：

{{< audio src="voxcpm.wav" >}}

## 效果对比

### 参考音频

{{< audio src="child.wav" >}}

### IndexTTS-2

{{< audio src="indextts.wav" >}}

### CosyVoice

{{< audio src="cosyvoice.wav" >}}

### GPT-SoVITS

{{< audio src="GPT-SoVITS.wav" >}}

### Fish Speech

{{< audio src="fish-speech.wav" >}}

### VoxCPM

{{< audio src="voxcpm.wav" >}}

从试听结果来看，IndexTTS-2、CosyVoice、Fish Speech 和 VoxCPM 的整体完成度更高，但IndexTTS-2的合成耗时明显更长。

## 方案总结

结合这次在同一测试环境、同一参考音频和同一目标文本下的部署与试听结果，可以得到一个比较清晰的结论：

~~从样本音色相似度来看，**Fish Speech** 和 **CosyVoice** 的整体表现更突出，**IndexTTS-2** 次之，**GPT-SoVITS** 在当前测试中的效果相对一般。如果目标是尽快验证“零样本音色克隆是否可用”，CosyVoice 会是更稳妥的选择。~~

~~从推理耗时来看，**GPT-SoVITS** 最快，单次合成大约在 10 秒左右；**CosyVoice** 次之，约 24 秒；**Fish Speech** 大约 1 分钟；**IndexTTS-2** 最慢，约 2 分 38 秒。对于需要更高响应速度的场景，GPT-SoVITS 和 CosyVoice 更有优势。~~

~~从部署复杂度来看，**CosyVoice** 整体最平衡，安装和调试成本相对最低；**Fish Speech** 和 **GPT-SoVITS** 都需要处理更多依赖和环境细节；**IndexTTS-2** 的网络依赖和外部模型链路较多，部署过程中的不确定性也更高。~~

~~快速上手的话，我更推荐**CosyVoice**方案。~~

**VoxCPM** 部署简单，效果非常好，同时支持cpu/cuda/mps方式运行，强烈推荐！！！
