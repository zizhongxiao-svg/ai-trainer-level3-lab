# 制作 Windows 一键安装包（Setup.exe）

本目录用于把社区版打包成一个 Windows `Setup.exe`，给不熟悉命令行的用户：
**双击安装 → 桌面出现「AI训练师三级 备考通」→ 双击启动 → 浏览器自动打开。**

底层仍通过 Docker 运行（社区版安装包**不内置** Docker Desktop），所以使用者机器上需要装好 Docker Desktop。

---

## 一、前置

- 一台 **Windows 10/11**（Inno Setup 与 .exe 编译只能在 Windows 上完成）
- [Inno Setup 6](https://jrsoftware.org/isdl.php)（免费）
- 能跑 Docker 的环境（用来先构建镜像）：Linux/macOS/Windows 均可

## 二、构建应用镜像（一次）

在**项目根目录**执行：

```bash
./build_release.sh
```

会在 `dist/` 下生成 `ai-trainer-level3-lab-vXXXX/ai-trainer-level3-lab.tar.gz`（Docker 镜像，约 1GB+，含 ONNX 模型）。

> 没有 Docker 构建环境时，也可以在任意装了 Docker 的机器上：
> `docker build -t ai-trainer-level3-lab:latest . && docker save ai-trainer-level3-lab:latest | gzip > ai-trainer-level3-lab.tar.gz`

## 三、放置镜像到 payload

把上一步的 `ai-trainer-level3-lab.tar.gz` 拷到：

```
installer/payload/ai-trainer-level3-lab.tar.gz
```

（`payload/` 已在 `.gitignore` 中，镜像不会被提交进仓库。）

> 跳过这一步也能编译，但生成的安装包不含镜像——首次启动时 `启动.bat` 会回退到在本机查找已有的 `ai-trainer-level3-lab:latest` 镜像。

## 四、编译 Setup.exe

用 Inno Setup 打开 `installer/ai-trainer-setup.iss`，点 **Build**（或命令行 `iscc installer\ai-trainer-setup.iss`）。

产物在：

```
installer/Output/AITrainer-Level3-Setup-XXXX.exe
```

## 五、使用者体验

1. 双击 `AITrainer-Level3-Setup-XXXX.exe`
   - 若未装 Docker，安装向导会提示去官网安装并可中止
2. 安装到 `%LOCALAPPDATA%\AITrainerLevel3Lab`（当前用户可写，无需管理员）
3. 桌面/开始菜单出现「AI训练师三级 备考通」
4. 双击启动 → 自动导入镜像 + `docker compose up -d` + 打开 `http://localhost:8097`
5. 账号、答题进度保存在安装目录的 `persist\`（**卸载不会删除**）

## 六、注意

- 这是 **Option A（Docker 方案）**：体积大、依赖 Docker/WSL2、仅 Windows。
- 想要**完全免 Docker 的原生 exe**（内嵌 Python 运行时），需要在 Windows 上为
  `xgboost / onnxruntime / opencv / scipy` 生成原生 wheel 后再用 Inno Setup 封装，工作量更大，本目录暂未提供。
- 不要把 `installer/payload/*.tar.gz`、`installer/Output/*.exe` 提交进 Git（已忽略）。
