# 小团团 · 待机动画包

使用项目现有 pet pack 机制，独立于主宠物的动画池。包含一只默认显示在桌面左下角的宠物，仅播放待机动画；没有配置漫游、转身、点击或睡觉动作。

## 独立配置

本目录独立保存新宠物的配置和素材，不写入项目内置的 `dsh-pet/assets/config.jsonc`，也不自动安装到本机已有的 dsh-pet 用户目录。配置中的宠物实例 ID 为 `blue-haired-girl-1`，素材组名为 `blue-haired-girl`。

```text
pet/
├── blue-haired-girl-config.json
└── blue-haired-girl-animation/
    └── 待机呼吸.webm
```

素材为用户提供的 AI 生成视频《Q版角色10秒待机动画生成.mp4》加工结果：去除绿色背景、外围水印及脚下椭圆阴影，移除音轨，输出 640×360、24 fps、10 秒的 VP9 Alpha WebM。末尾 0.5 秒柔和回到起始姿态，改善循环接缝。

`events.balance` 是现有配置校验要求的非空字段，使用本组待机素材兜底；该宠物的自动余额、碎碎念和工作状态联动均关闭，不会引用原角色素材。

Chrome / Edge / Electron 可播放透明 WebM；本包没有提供 Safari 所需的 HEVC Alpha MOV。原始视频和角色图由用户提供，其授权不由原项目 MIT 许可代替。
