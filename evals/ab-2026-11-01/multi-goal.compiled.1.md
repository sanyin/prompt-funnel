# 爬虫 + 代理池 + 可视化面板 完整实现

由于你未指定目标网站，我采用 **Python 技术栈**，以 `https://httpbin.org/ip` 作为**示例目标**（可验证代理是否生效），你可以替换成任意目标站点。整体架构如下：

```
┌─────────────┐    ┌──────────────┐    ┌────────────────┐
│  爬虫 Worker │───▶│   代理池      │───▶│  目标网站       │
│  (多线程)    │    │ (健康检测)    │    └────────────────┘
└──────┬──────┘    └──────┬───────┘
       │                  │
       └────────┬─────────┘
                ▼
        ┌───────────────┐
        │  SQLite 数据   │
        └───────┬───────┘
                ▼
        ┌───────────────┐
        │ Flask + 前端   │  ← 可视化面板
        └───────────────┘
```

## 文件结构

```
spider_project/
├── requirements.txt
├── config.py
├── proxy_pool.py
├── spider.py
├── app.py
├── templates/
│   └── dashboard.html
└── data.db          # 运行时自动生成
```

---

## 1. `requirements.txt`

```txt
requests>=2.31.0
flask>=3.0.0
```

## 2. `config.py`

```python
# 目标网站（示例：httpbin 返回请求来源 IP，可换成任意站点）
TARGET_URL = "https://httpbin.org/ip"

# 爬取总量与并发
TOTAL_TASKS = 50
WORKER_THREADS = 5

# 代理池配置
PROXY_CHECK_URL = "https://httpbin.org/ip"
PROXY_CHECK_TIMEOUT = 5
PROXY_MAX_FAIL = 3          # 连续失败几次后剔除
PROXY_REFRESH_INTERVAL = 60 # 秒，定期重新检测

# 数据库
DB_PATH = "data.db"

# 请求头
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; DemoSpider/1.0)"
}

# 初始代理列表（示例：公开代理，生产环境请替换成你自己的代理源）
INITIAL_PROXIES = [
    # "http://user:pass@1.2.3.4:8080",
    # "http://5.6.7.8:3128",
]
```

## 3. `proxy_pool.py` — 代理池

```python
import threading
import time
import requests
from config import (
    PROXY_CHECK_URL, PROXY_CHECK_TIMEOUT, PROXY_MAX_FAIL,
    PROXY_REFRESH_INTERVAL, INITIAL_PROXIES, HEADERS,
)


class ProxyPool:
    """线程安全的代理池：检测可用性、轮询取用、失败计数剔除。"""

    def __init__(self, proxies=None):
        self._lock = threading.Lock()
        self._proxies = {}
        for p in (proxies if proxies is not None else INITIAL_PROXIES):
            self._proxies[p] = {"fail": 0, "alive": False, "last_ok": 0}
        self._index = 0
        self._stop = False

    # ---------- 对外接口 ----------
    def add(self, proxy):
        with self._lock:
            self._proxies.setdefault(proxy, {"fail": 0, "alive": False, "last_ok": 0})

    def get(self):
        """轮询返回一个存活代理，无可用则返回 None。"""
        with self._lock:
            alive = [p for p, v in self._proxies.items() if v["alive"]]
            if not alive:
                return None
            self._index = (self._index + 1) % len(al
