# Google App Ultra 原生30TB实验4

本模块用于检查原生套餐响应中的商品编号替换是否会影响 Apple 报价。它只处理 `subscriptionsmobile-pa.googleapis.com/.../GetDynamicStorefrontInfo` 的 POST 响应，不把本地改写结果当作购买成功或 Ultra 权益证明。

原生映射固定为：

```text
g1.ios.30tb.ai.pro.m  →  g1.ios.30tb.m
```

来源是诊断中已观察到的完整编号；目标沿用原有网页30TB规则得到的完整编号。旧编号的可售性、适用账号、价格和 Google 实际权益尚未独立验证。

默认只在下列已观察路径上匹配完整源编号，同一路径的重复字段都会处理：

```text
1.11.1.11.1.18.1.2.20.1.11.1.11.1.11.1.13.1.11.1.12.1.3.4.9.4.1.2.2.1
```

数字路径来自无 .proto 的结构检查，不能据此确认字段一定用于本次下单。其他路径上的同名编号、20TB编号以及价格和会员状态字段不由原生脚本改写。模块另保留原来的两条网页内置重写，供旧网页流程使用。

脚本重算已修改 LEN 字段及祖先消息的 varint 长度，处理未压缩 gRPC 的帧长度，并保留 gRPC-web 尾部帧。解析失败、超出限制、压缩编码、未知内容类型或字段路径未命中时返回原始响应。[Protobuf 编码说明](https://protobuf.dev/programming-guides/encoding/)

## 使用

1. 使用发布时给出的固定版本远程模块链接，替换现有测试模块地址。停用其他 Google One 商品改写模块，沿用已受信任的 Egern 证书。
2. 本模块使用升级后的 Egern 新 Script API。`MODE` 默认 `rewrite`；字段路径留空时使用上述已观察路径。`inspect` 可做不改写原生响应的对照。
3. 保存后重连 Egern，完全退出 Google App，再重新进入 Ultra 升级入口。检查“Ultra 原生30TB · 实验4”通知。
4. 先核对通知的“指定路径匹配”和“实际替换”。再查看 Apple 确认面板中的 App、商品名称、容量、币种、金额和计费周期，取消面板后记录结果。此检查不需要确认付款。
5. 点击通知可复制报告。通知未显示时，在 Egern“设置 → 日志”中查看 `[ultra_native4]` 的结果。

| 状态 | 含义 |
| --- | --- |
| `rewritten` | 已构造修改后的原生响应，实际替换数大于0；尚未证明 App 使用了该字段 |
| `candidate_found` | 指定路径上有完整值匹配，当前为 inspect，原响应未修改 |
| `path_not_matched` | 其他可解析路径存在源编号，默认路径未命中；不会自动扩大改写范围 |
| `no_source_sku` | 本次可解析字段没有完整源编号，不代表商品下架 |
| `invalid_field_paths` / `invalid_mode` | 模块参数无效，响应不修改 |
| `parse_failed_passthrough` / `limit_passthrough` | 解析失败或超出限制，返回原始正文 |
| `encoded_response_passthrough` / `unsupported_content_type` / `http_not_2xx` | 当前响应未进入可改写分支 |

候选列表取自修改前的数据；在其中看到源编号不代表改写失败。报告分别列出总源字段、选定路径匹配、实际替换和处理后剩余源编号。未选择路径里的编号保持原样，剩余数量可以大于0。

若出现 `rewritten` 但 Apple 报价不变，应继续核对 App 是否使用此字段、是否有后续目录响应或其他购买路径，以及实际商品和结算资格；不能只据本地替换计数认定是账号资格限制。

## 验证范围

脚本通过21项 Node 离线检查，覆盖完整值和路径限制、30层嵌套、缩短跨越128/16384长度边界、gRPC帧、非目标数据保留、失败透传和报告范围。另在本机 JavaScriptCore 中检查 rewrite/inspect 两个场景；引擎是真实的，Egern API 桥接仍为替身。未运行手机上的购买，也未验证具体 Apple 价格或 Google 权益。

模块和脚本的发布链接固定到提交，避免 main 分支的 Raw 缓存返回旧内容。换版本时应使用新的模块链接。

脚本只保存本机的状态、计数、数字路径和最多64个去重商品样式字符串，不自动上传报告。HTTP 抓包记录独立于脚本报告，完整记录可能包含账户数据。

官方接口依据：[Egern 脚本配置](https://egernapp.com/zh-CN/docs/configuration/scriptings/)、[Egern JavaScript API](https://egernapp.com/zh-CN/docs/javascript-api/)。

