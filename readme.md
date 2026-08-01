# images-worker

基于 Cloudflare Workers + R2 的图片分发服务，通过 SHA-256 哈希值快速访问图片资源，内置多级缓存和跨域支持。

## 功能特性

- **Cloudflare Workers**：边缘计算，全球低延迟访问
- **R2 存储桶**：图片对象存储，零出口流量费用
- **多级缓存**：
  - Cloudflare Cache API 缓存图片内容（30 天）
  - 元数据缓存（图片路径 + MIME 类型）
- **哈希路由**：通过 64 位 SHA-256 哈希值定位图片
- **跨域支持**：CORS 预请求处理，支持全域名访问
- **容错机制**：上游 API 超时自动重试（最多 2 次）
- **精确匹配**：文件名哈希精确匹配，避免子串误命中

## 技术栈

| 类别 | 技术 |
| --- | --- |
| 运行时 | Cloudflare Workers |
| 存储 | Cloudflare R2 |
| 语言 | TypeScript |
| 包管理 | pnpm |
| 测试 | Vitest + @cloudflare/vitest-pool-workers |
| 部署工具 | Wrangler v4 |

## 项目结构

``` text
images-worker/
├── src/
│   └── index.ts          # Worker 主入口
├── test/
│   ├── index.spec.ts     # 测试用例
│   ├── env.d.ts          # 测试类型声明
│   └── tsconfig.json     # 测试 tsconfig
├── wrangler.jsonc        # Wrangler 配置
├── tsconfig.json         # TypeScript 配置
├── vitest.config.mts     # Vitest 配置
├── package.json
└── pnpm-workspace.yaml
```

## 快速开始

### 环境要求

- Node.js >= 18
- pnpm >= 8
- Cloudflare 账号（已开通 Workers 和 R2 服务）

### 安装依赖

```bash
pnpm install
```

### 本地开发

```bash
pnpm dev
```

默认监听 `http://localhost:8787`，支持热更新。

### 运行测试

```bash
pnpm test
```

### 生成类型声明

修改 `wrangler.jsonc` 中的 bindings 后，生成类型定义：

```bash
pnpm cf-typegen
```

### 部署到生产

```bash
pnpm deploy
```

## 配置说明

### wrangler.jsonc

```jsonc
{
  "name": "images-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-01",
  "observability": {
    "enabled": true
  },
  "r2_buckets": [
    {
      "bucket_name": "images",       // R2 存储桶名称
      "binding": "R2_BUCKET"          // Worker 中的绑定变量名
    }
  ]
}
```

### 上游 API 配置

在 `src/index.ts` 中修改：

```typescript
const imagesApiUrl = 'https://api.astrvis.top'  // 图片元数据 API 地址
const imgCacheTime = 2592000                     // 图片缓存时间（秒），默认 30 天
```

## API 接口

### GET /:hash

通过图片哈希获取图片资源。

**参数：**

| 名称 | 类型 | 描述 |
| --- | --- | --- |
| hash | string | 64 位 SHA-256 哈希值 |

**响应：**

- 成功：`200 OK`，返回图片二进制流，`Content-Type` 根据图片类型自动设置
- 未找到：`404 Not Found`
- 参数错误：`400 Bad Request`
- 上游错误：`500 Internal Server Error`
- 请求超时：`504 Gateway Timeout`

**响应头：**

``` text
Cache-Control: public, max-age=2592000
CDN-Cache-Control: public, max-age=2592000
Access-Control-Allow-Origin: *
```

### OPTIONS /*

CORS 预检请求处理。

``` text
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET,OPTIONS
Access-Control-Allow-Headers: *
```

## 工作流程

``` text
请求到达
   │
   ├─► OPTIONS 预检 ──────────────────────────────► 返回 CORS 头
   │
   ├─► 校验 hash 格式（64 位） ── 格式错误 ──────► 404
   │
   ├─► 查询图片内容缓存 ── 命中 ─────────────────► 返回缓存
   │         │
   │         ▼ 未命中
   ├─► 查询元数据缓存 ── 命中 ──────────────────► 解析路径+类型
   │         │
   │         ▼ 未命中
   ├─► 请求上游 API 获取图片信息 ── 失败 ────────► 404/500
   │         │
   │         ▼ 成功
   ├─► 精确匹配文件路径哈希 ── 不匹配 ───────────► 404
   │         │
   │         ▼ 匹配
   ├─► 缓存元数据 ───────────────────────────────► 存入缓存
   │         │
   │         ▼
   ├─► 从 R2 存储桶读取图片 ── 不存在 ───────────► 404
   │         │
   │         ▼ 存在
   └─► 缓存图片内容并返回
```

## 开发规范

- 使用 TypeScript 严格模式 (`"strict": true`)
- 遵循 `.editorconfig` 和 `.prettierrc` 代码格式
- 提交前确保测试通过

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件。
