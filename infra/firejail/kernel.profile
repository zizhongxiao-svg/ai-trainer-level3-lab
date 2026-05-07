# 备考通 Phase 2 · Jupyter kernel firejail 基线
# 仅在 TRAINER_SANDBOX=firejail 时启用。默认不启用。

include default.profile

# 权限最小化
caps.drop all
noroot
seccomp
nonewprivs
net none

# fd / 内存上限
nofile 512
rlimit-as 2147483648
rlimit-nproc 128

# 只读关键目录
read-only /usr
read-only /etc
read-only /app/app

# 私有 tmp / dev
private-tmp
private-dev
private-etc none

# 明确不让 kernel 访问 HOME 下的其它内容
blacklist ${HOME}/.ssh
blacklist ${HOME}/.aws
blacklist ${HOME}/.config
