# 完整爬虫 + 代理池 + 可视化面板方案

下面给你一套**可直接运行**的完整方案，包含三个模块：

1. **代理池**（自动采集 + 校验 + 存储）
2. **爬虫**（带代理轮换、重试、并发）
3. **可视化面板**（Flask + ECharts）

---

## 📁 项目结构

```
spider_project/
├── proxy_pool/
│   ├── __init__.py
│   ├── fetcher.py        # 代理抓取
│   ├── validator.py      # 代理校验
│   └── pool.py           # 代理池管理
├── spider/
│   ├── __init__.py
│   └── crawler.py        # 爬虫主体
├── dashboard/
│   ├── app.py            # Flask 面板
│   └── templates/
│       └── index.html    # 前端页面
├── data/
│   └── results.json      # 爬取结果
├── requirements.txt
└── main.py               # 主入口
```

---

## 1️⃣ requirements.txt

```txt
requests>=2.31.0
beautifulsoup4>=4.12.0
flask>=3.0.0
aiohttp>=3.9.0
lxml>=4.9.0
```

安装：
```bash
pip install -r requirements.txt
```

---

## 2️⃣ 代理池模块

### `proxy_pool/fetcher.py` — 从免费源抓取代理

```python
import requests
import re
from concurrent.futures import ThreadPoolExecutor

# 免费代理源（可自行扩展）
PROXY_SOURCES = [
    "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
    "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
    "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt",
]

def fetch_from_source(url: str) -> list[str]:
    """从单个源抓取代理"""
    try:
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        # 匹配 ip:port 格式
        proxies = re.findall(r'\b(?:\d{1,3}\.){3}\d{1,3}:\d{2,5}\b', resp.text)
        return list(set(proxies))
    except Exception as e:
        print(f"[抓取失败] {url}: {e}")
        return []

def fetch_all_proxies() -> list[str]:
    """并发抓取所有源的代理"""
    all_proxies = set()
    with ThreadPoolExecutor(max_workers=5) as executor:
        results = executor.map(fetch_from_source, PROXY_SOURCES)
        for proxies in results:
            all_proxies.update(proxies)
    print(f"[代理池] 抓取到 {len(all_proxies)} 个原始代理")
    return list(all_proxies)
```

### `proxy_pool/validator.py` — 校验代理可用性

```python
import requests
from concurrent.futures import ThreadPoolExecutor

# 用于校验的测试地址
TEST_URL = "http://httpbin.org/ip"
TIMEOUT = 5

def validate_proxy(proxy: str) -> str | None:
    """校验单个代理，返回可用代理或 None"""
    proxies = {"http": f"http://{proxy}", "https": f"http://{proxy}"}
    try:
        resp = requests.get(TEST_URL, proxies=proxies, timeout=TIMEOUT)
        if resp.status_code == 200:
            return proxy
    except Exception:
        pass
    return None

def validate_proxies(proxies: list[str], max_workers: int = 50) -> list[str]:
    """并发校验代理"""
    valid = []
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        results = executor.map(validate_proxy, proxies)
        for p in results:
            if p
