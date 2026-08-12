# Style Bible（现有视觉规范）

> 稳定层 · 设计铁律。设计组与前端员工 **verbatim 沿用**，不得自行引入新值。
> 本文件照抄自 `style.css` 与 `index.html`（抽取于 2026-08-11，网站版本 v1.39）。若你后续微调风格，以最新代码为准重抽。

## 1. 设计语言（轻中式 / 现代简洁）
- 关键词：高级留白、克制、自然舒展的 2.5D 药柜、低饱和木质 + 苔绿。
- 中式表达靠**留白、木色、苔绿、印章式版本徽标**含蓄体现，不堆砌纹样。
- 全局无衬线，绝不加衬线字体。

## 2. :root 设计令牌（11 色 + 2 影，逐字沿用）
```css
:root {
    --bg-page: #FAF7EF;        /* 页面背景：暖米白 */
    --text-main: #25352B;      /* 主文字：深苔绿黑 */
    --text-muted: #6F7A70;     /* 次要文字：灰绿 */
    --primary-green: #3F6543;  /* 主绿（按钮 / logo / 强调） */
    --deep-green: #243C2C;     /* 深绿（主标题） */
    --light-green-bg: #EAF1E7; /* 浅绿底（标签 / 高亮块） */
    --wood-dark: #9B6B43;      /* 木色深 */
    --wood-main: #B98756;      /* 木色主 */
    --wood-light: #D7B58A;     /* 木色浅 */
    --border-color: #E5D8C5;   /* 描边 / 分隔 */
    --card-white: #FFFDF8;     /* 卡片白（微暖） */
    --shadow-soft: 0 10px 30px -5px rgba(0,0,0,0.05);
    --shadow-deep: 0 20px 40px -10px rgba(0,0,0,0.1);
}
```
> 药柜专用木色（非 :root 变量，硬编码）：正面 `#B08B66`、外框 `#8C6543`。

## 3. 字体
- `font-family: 'Inter', 'PingFang SC', 'Microsoft YaHei', sans-serif;`
- 不加衬线，不换字体栈。

## 4. 药柜 2.5D 透视参数（**绝不改动**）
```
容器 .cabinet-wrapper:
  perspective: 1200px;
  perspective-origin: 30% 50%;
  overflow: visible;            /* 禁止裁剪 3D 侧板 / 顶板 */

正面 .medicine-cabinet:
  transform: rotateY(-14deg) rotateX(1.5deg);
  transform-origin: left center;
  background: #B08B66;
  border: 10px solid #8C6543;

顶面 .cabinet-top-panel:   rotateX(-90deg) + origin top center
侧面 .cabinet-side-panel:  clip-path: polygon(0% 0%, 100% 4%, 100% 96%, 0% 100%);  /* 梯形贴合 */

抽屉 .cabinet-drawer:
  默认 translateZ(-22px)；hover/open → translateZ(30px) 向外拉出
  （transition: transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)）
  六面 front/back(rotateY 180)/left(90)/right(-90)/top(90)/bottom(-90)，均 translateZ(22px)
```

## 5. 组件模式（复用既有类）
- **导航栏 `.navbar`**：高 64px，白色 80% 半透 + `blur(10px)`，底部 1px `--border-color`，sticky 顶，z-index 100；`.nav-container` 最大宽 1280px 居中。
- **主搜索 `.search-container`**：白底、高 64、圆角 32、1px 边框 + `--shadow-soft`；focus-within 切 `--shadow-deep` + 边框变 `--primary-green`。按钮 `.search-button`：主绿底白字、圆角 26、hover 微抬。
- **卡片**：白底 `--card-white`、圆角、软阴影；标签用 `--light-green-bg` 底 + 主绿字。
- **版本徽标 `.version-badge`**：`position: fixed; bottom:12px; right:14px;`，每次改动 **+1**（当前 v1.39，见 index.html:154）。

## 6. 用户精心调校的硬约定（不得破坏）
1. 颜色只从 `:root` 11 变量 + 药柜专用木色取用，**不引入新色**。
2. 字体保持 `Inter, PingFang SC, Microsoft YaHei, sans-serif`，**不加衬线**。
3. 药柜透视固定 `rotateY(-14deg) rotateX(1.5deg)` / `perspective:1200px` / `origin:30% 50%` / 侧板 `clip-path` 梯形——**绝不改动**。
4. hover / active / 选中 反色与位移规则全局一致（参见 `.search-button:hover`、抽屉拉出位移）。
5. 改动后 `.version-badge` **版本号 +1**。
6. 响应式断点 `1280 / 1101 / 1100 / 1024 / 900 / 768 / 480` 不得破坏（移动端药柜改 `min(440px,92vw)`、卡片静态堆叠）。

## 7. 给设计组 / 前端员工的约束
- 任何新增 UI 必须从这 11 个变量 + 2 个木色挑色，禁止 `#xxxxxx` 新值。
- 任何新组件对照第 5 节既有类，优先复用而非新建。
- 药柜、版本徽标、响应式断点**只读**，改动需用户显式批准。
