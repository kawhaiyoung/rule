# Google One Egern 模块使用说明

这些模块涉及两条不同路径：Google 搜索 App 中的 `one.google.com/ai` 网页响应，以及 Google One 原生目录的 protobuf 响应。原生目录中的100GB商品查询测试不能代替 Google App 的 Ultra 订阅流程。商品字段、苹果报价和 Google 权益需要分别核对。

## 选择模块

| 模块 | 响应范围 | 默认行为 |
| --- | --- | --- |
| [Google App 教程对照模块](https://raw.githubusercontent.com/kawhaiyoung/rule/main/GoogleApp_Ultra_Web_Egern.yaml) | `https://one.google.com/ai` 及其查询参数；按教程在彩色G图标的 Google 搜索 App 中使用 | 20TB、30TB文本规则均开启；没有原生脚本诊断通知 |
| [原有网页版模块](https://raw.githubusercontent.com/kawhaiyoung/rule/main/GoogleOne_TR_Ultra_Egern.yaml) | `https://one.google.com/ai` 及其查询参数 | 文本替换，30TB 规则开启，20TB 备用规则关闭 |
| [原生 20TB 实验模块](https://raw.githubusercontent.com/kawhaiyoung/rule/main/GoogleOne_Native_20TB_Egern.yaml) | 截图中的 `subscriptionsmobile-pa.googleapis.com`，路径以 `/GetDynamicStorefrontInfo` 结尾的 POST 响应 | `inspect` 检查模式，返回原响应字节 |
| [旧20TB商品查询测试](https://raw.githubusercontent.com/kawhaiyoung/rule/main/GoogleOne_Legacy20TB_Probe_Egern.yaml) | 同一原生接口，固定使用 `g1.ios.100gb.m` 作为来源 | 默认 `inspect`；需明确切换 `rewrite` 才会让 100GB 月付入口尝试查询旧20TB商品 |

原生模块会下载[配套 JavaScript](https://raw.githubusercontent.com/kawhaiyoung/rule/main/GoogleOne_Native_20TB_Egern.js)。它使用 Egern 官方原生脚本 API，要求当前版本支持 `export default async function(ctx)`、`binary_body` 和 `arrayBuffer()`。本次没有推断或添加原生 30TB 映射。

## NodeSeek教程对照与入口修正

新参考为[NodeSeek教程](https://www.nodeseek.com/post-1070216-1)及其[第二页回复](https://www.nodeseek.com/post-1070216-2)。作者要求从 Google App 的设置进入 Google One 订阅；购买截图显示彩色G图标，苹果面板为30TB、每月 TRY 2,949.99。作者还限定为新订阅，并称已有Lite等方案的升级不适用。这是教程作者的适用条件，尚未独立验证。

教程的两条文本规则与原有网页版模块相同。新增的 Google App 模块把两条规则都启用，并明确标注 App 和接口范围。它保留响应中已有的完整商品编号前缀，只修改下列片段：

```text
20tb.m.v2     → 20tb.m
30tb.ai.pro.m → 30tb.m
```

这里的 Google App 指[Google 搜索应用](https://apps.apple.com/tr/app/google/id284815942)。教程截图中的 Google App 购买流程，与原生探针借用 Google One 的100GB入口查询固定旧商品编号，是两种实验；不能因为容量相同就视为同一笔商品和权益。

1. 取消尚未完成的测试购买面板，停用100GB查询模块和其他 Google One SKU 模块。
2. 在 Egern 中导入并启用“Google App Ultra 网页 SKU 改写（教程对照）”，沿用已安装、受信任的 Egern 证书。
3. 先核对账号是否符合作者声称的“新订阅”条件，不要为了建立入口而购买 Lite 或100GB等其他方案。
4. 在彩色G图标的 Google App 中，按教程进入设置中的 Google One 订阅入口，再选择 Ultra 方案。实际菜单可能随版本和账号状态变化，以手机界面为准。
5. 在 Egern HTTP 抓包中核对是否产生 `one.google.com/ai` 请求，以及实际响应中是否存在相应源片段。本模块使用 Egern 内置文本重写，不会弹出 `candidate_found` 或 `rewritten` 通知；抓包视图若显示原始响应，也不能仅凭原字符串仍在就判定改写失败。
6. 只查看苹果购买面板，核对所属 App、商品、币种、金额和周期，然后取消。页面价签和苹果报价可能不同，二者都不能证明 Google 后端已授予 Ultra。

模块按主机和URL匹配，不能识别请求由哪个 App 发起；访问同一URL的其他客户端也可能受到规则影响。检查结束后停用模块。

证据范围：帖子提供了改写配置和苹果购买面板，[回复中有人自述成功](https://www.nodeseek.com/post-1070216-1#10)。所查看的截图没有展示购买完成后的 Google Ultra 会员状态，也没有提供具体旧SKU与Ultra权益的官方对应关系。因此，这篇教程不足以确认100GB探针所查询的旧20TB商品一定包含Ultra，也不足以保证新的 Google App 流程能够长期保留权益。

Google App模块仅完成 YAML、URL边界和合成文本替换的离线检查，尚未在手机的 Google App 中实测。原生脚本的37项检查不代表这条网页流程已经通过手机验证。

## 通过100GB月付入口测试旧20TB商品

此测试用于检查 App 是否接受替换后的商品编号，以及苹果是否仍能返回旧20TB商品和报价。它不验证 Google 会为该商品授予哪些权益。StoreKit 可以按 App 从服务器取得的商品编号查询商品，但当前 App 是否会按修改后的字段发起查询，仍需实际核对。[Apple 商品查询 API](https://developer.apple.com/documentation/storekit/product/products(for:).md)

测试模块固定使用以下映射：

```text
g1.ios.100gb.m  →  com.google.one.20tb.m.iog
```

1. 停用其他 Google One SKU 改写模块，启用“旧20TB商品查询测试”。沿用已有的 Egern 证书。
2. 保持 `inspect`，重连 Egern，完全退出并重新打开 Google One，让它重新加载普通存储套餐。检查通知标题为“Google One 旧20TB商品查询测试”，源编号应为 `g1.ios.100gb.m`。
3. 只有通知出现 `candidate_found`、匹配数量大于 0 时，才将测试模式改为 `rewrite`。保存，重连 Egern，再次完全退出并重新打开 Google One。
4. 确认新通知出现 `rewritten`，然后在普通存储套餐中选择 **100GB 月付**。本测试不处理100GB年付条目，也不要求从 Ultra 页面进入。
5. 在苹果购买确认面板中查看商品名称、容量、币种、金额和周期。记录这些内容后取消购买面板，停用测试模块。不要在此查询测试中确认购买。

Google One 的页面文字可能仍写100GB，因为测试只替换商品编号。苹果确认面板显示的商品必须另行核对；Google One 页面本身的容量和价格不能作为测试结果。如果苹果仍显示100GB、提示商品不可用，或没有出现购买面板，则此次查询没有得到预期验证。即使苹果返回20TB商品，也只能说明该次商品查询有结果，不能证明它具有 Ultra 权益。

共享脚本只接受预设的截图来源编号和此100GB月付来源编号，查询目标固定为旧20TB编号；默认原生模块仍使用截图中的20TB来源。测试模块使用独立名称和版本化脚本链接，不会把现有原生模块的默认检查来源改为100GB。

## 在 Egern 中导入原生模块

1. 在模块管理中添加远程模块，粘贴上表中的原生模块链接。按模块导入，继续使用现有主配置。
2. 使用 Egern 自己生成的证书，在 iOS 中安装并信任；已有可用证书可继续使用。模块只声明上述 Google 原生接口域名的 MITM 与 HTTP 抓包。
3. 确认模块设置中的运行模式为 `inspect`，启用模块并重新连接 Egern。完全退出 Google One，再打开套餐页面。
4. 进入需要检查的套餐详情或选择页面，再查看新产生的“Google One 原生接口 · 诊断3”通知。首页也可能触发同名接口，不能直接用首页的一次结果代表 Ultra 套餐页面。`candidate_found` 表示在可解析的响应中找到完整值相同的候选字段，`no_match` 表示没有找到符合当前路径条件的目标字段。
5. 通知预览最多八个去重后的候选编号，并显示预览数量和收录是否截断。点击通知可复制报告；报告包含本次收录的全部不同编号，最多 64 个，重复出现的编号只占一个位置。通知中的候选不等于已经确认的可购买商品。
6. 核对候选字段对应的商品后，可在模块设置中把运行模式改为 `rewrite`。如需限制修改位置，在“字段编号路径”中填写本机诊断记录中的路径；多个路径用英文逗号分隔。再次触发新的套餐请求。

原生脚本只匹配以下完整值，不做子串替换：

```text
g1.ios.20tb.m.v2  →  com.google.one.20tb.m.iog
```

`rewritten` 表示本地脚本已构造修改后的响应，不代表 App 已采用该商品，也不代表购买或权益开通成功。苹果购买面板中的商品、地区、计费周期和金额，以及 Google 实际显示的订阅权益，需要分别核对；这些离线检查不需要付款。

如果模块设置没有显示选项，可在主配置中的模块引用下指定环境变量，替换已有的同一模块引用即可：

```yaml
modules:
  - url: 'https://raw.githubusercontent.com/kawhaiyoung/rule/main/GoogleOne_Native_20TB_Egern.yaml'
    enabled: true
    env:
      MODE: 'inspect'
      NOTIFY: 'true'
```

## 读取结果

| 状态 | 含义和下一步 |
| --- | --- |
| 没有通知和请求记录 | 尚不能确认规则命中。先检查模块、MITM 证书、当前 App 的实际接口与传输协议 |
| `candidate_found` | 找到完整值匹配的候选字段；根据实际响应核对它的用途 |
| `rewritten` | 已替换候选值并重算相关长度 |
| `no_match` | 此次响应未出现目标值，或设置的字段路径未命中 |
| `unsupported_content_type` | 响应类型不在实验模块支持范围内，原样透传 |
| `encoded_response_passthrough` | 服务器仍返回压缩编码，脚本不读取或修改该响应 |
| `http_error` | 接口返回非 2xx 状态，原样透传；不能据此认定某个 SKU 无效 |
| `parse_failed_passthrough` | 数据结构不受支持或解析失败，返回原始字节 |
| `limit_passthrough` | 超过脚本的体积、字段数量或嵌套深度限制，返回原始字节 |
| `invalid_mode` 或 `invalid_field_paths` | 检查模块环境变量的拼写和字段路径格式 |

### 诊断 no_match

先将“字段编号路径”留空。切换为 `rewrite` 不会解决未匹配的问题，两种模式使用同一套匹配条件。

| 通知里的诊断值 | 能确认的情况 |
| --- | --- |
| 候选编号不同于目标值 | 可识别的字段中出现了其他编号；现有 20TB 规则不会修改它们 |
| 目标原文为 0 处 | 本次已读取的正文不包含截图中目标字符串的字节序列，不能据此认定旧商品已经下架 |
| 目标原文大于 0，仍为 `no_match` | 该字符串可能位于复合文本或尚未识别的嵌套数据中，需要核对结构；也应检查是否填写了路径过滤条件 |
| 正文为 0 字节 | 这次读取的是空正文，未获得可检查的商品内容 |
| 候选为“未识别” | 符合诊断格式的完整商品字符串没有出现在已识别的 LEN 字段中，不代表接口完全没有商品数据 |

诊断仅识别以 `g数字.ios.` 或 `com.google.one.` 开头、长度不超过 160 字节的完整 ASCII 候选字段。候选编号不等于已经确认的 SKU 语义，也不会据此自动增加改写规则。没有真实响应前，不推断其他编号对应哪个旧商品。

手动更新现有远程模块即可获取诊断更新。如果仍显示旧版通知，可将该模块地址末尾的版本参数改为 `?v=3`，完整地址为 `https://raw.githubusercontent.com/kawhaiyoung/rule/main/GoogleOne_Native_20TB_Egern.yaml?v=3`，再重新加载。保持 `inspect`，重连 Egern并重新打开 Google One；通知标题出现“诊断3”时，说明新脚本已经运行。

脚本将最近一次状态、计数、字段编号路径和最多 64 个去重后的候选商品编号保存在本机 Egern 存储中；不保存完整响应正文、请求头和收据，也不上传这些诊断数据。点击通知只会将诊断报告复制到本机剪贴板，由用户自行选择是否分享。模块开启的 Egern HTTP 抓包功能另有自己的记录，诊断结束后可在 Egern 中清理。

## 截图方法的适用范围

截图中的字符串长度有误：`g1.ios.20tb.m.v2` 为 16 字节，目标值为 25 字节。新增脚本重算发生修改的 LEN 字段及其祖先消息的 varint 长度；未修改字段保留原始字节。它也处理未压缩的 gRPC 帧长度，并保留 gRPC-web 尾部帧；压缩帧和 base64 gRPC-web 暂不处理。

没有对应的 `.proto` 定义时，LEN 类型本身不能区分字符串、bytes、嵌套消息和 packed 字段。脚本按完整消息解析和完整值匹配寻找候选，无法仅凭字段编号确认它就是 `product_id`。因此默认使用检查模式，路径限制也需要结合真实响应核对。[Protobuf 编码说明](https://protobuf.dev/programming-guides/encoding/)

开启 VPN 不等于 QUIC 会自动变成普通 HTTP CONNECT 中的 TCP。VPN 可以承载 UDP；是否退回 TCP，取决于客户端和代理的具体行为。抓不到目标请求时，应先确认实际传输方式，不能仅凭 VPN 已连接就断定已经解密。[QUIC 传输规范](https://www.rfc-editor.org/rfc/rfc9000.html)

截图所述“老 SKU 仍可售、价格约为某个金额、Google 认可其权益”均需现场验证。StoreKit 按商品编号查询由开发者在商店中配置的商品；本地改写不会改变 Apple 商店地区，也不会自行设定价格。Google 的收据处理还可能包含业务状态，HTTP 2xx 或 4xx 均不能单独证明某档套餐是否开通。[Apple 商品查询说明](https://developer.apple.com/documentation/storekit/product/products(for:).md)

## 验证记录与官方参考

共享脚本通过 37 项 Node.js 离线检查，覆盖两处 varint 长度边界、精确匹配、无关字段保留、gRPC 帧、URL 范围、失败透传、候选去重、截断提示、报告复制，以及受限100GB来源的检查和改写。Egern API 使用测试替身，检查结果不能替代对手机真实响应、商品字段和购买结果的核对。

将[测试脚本](https://raw.githubusercontent.com/kawhaiyoung/rule/main/GoogleOne_Native_20TB.test.mjs)与配套 JavaScript 放在同一目录，可用 `node --test GoogleOne_Native_20TB.test.mjs` 复查；[验证记录](https://raw.githubusercontent.com/kawhaiyoung/rule/main/GoogleOne_Egern_validation.json)列出了检查范围。

官方配置依据：[模块与环境变量](https://egernapp.com/zh-CN/docs/configuration/modules/)、[二进制脚本配置](https://egernapp.com/zh-CN/docs/configuration/scriptings/)、[原生 JavaScript API](https://egernapp.com/zh-CN/docs/javascript-api/)。原网页版规则来源为[用户最初提供的帖子](https://linux.do/t/topic/3216273)。
