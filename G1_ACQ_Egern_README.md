# G1 ACQ Egern：一折与试用

独立 Egern 模块，支持 Ultra 一折、试用两种候选入口、网页 SKU 被动采集、本地报告与 JSON 导出，并支持原生30TB已观察字段路径的 protobuf 改写。原来的实验4文件及固定版本地址保持原样。

优惠映射参考 [crhywun/g1-acq v7.7.0](https://github.com/crhywun/g1-acq/tree/3112623ade6a49d9e08b991a3e17333d599314b6)，以 Egern 新 Script API 重新实现。

## 远程订阅

[固定版本订阅](https://raw.githubusercontent.com/kawhaiyoung/rule/83835c95461652857933ecf9f073d3ced726a775/G1_ACQ_Egern.yaml)

在 Egern「工具 → 模块」中新增上面的模块，不覆盖原实验4。测试本模块时停用实验4和其他 Google One 商品改写模块；需要切换回来时，停用本模块再启用实验4。

沿用已有受信任的 Egern 证书。代码使用新版 `export default async function(ctx)` API；此前的2.16版本不适用，应使用升级后的 Egern。

## 参数

| 参数 | 默认 | 作用 |
| --- | --- | --- |
| `OFFER_MODE` | `discount` | 一折候选；改为 `trial` 尝试试用候选 |
| `ACTION` | `rewrite` | 尝试改写；`inspect` 只检查 |
| `NATIVE_30TB` | `true` | 开启受限原生30TB处理；关闭后原生只检查 |
| `NATIVE_PATHS` | 实验4已观察路径 | 留空沿用默认，不接受通配符 |
| `PRO_2TB` | `false` | 额外网页2TB候选，默认关闭 |
| `NOTIFY` | `true` | 网页和原生处理结果通知 |

切换优惠模式后，保存、重连 Egern，完全退出并重新打开彩色G图标的 Google App，再进入实际提供的套餐页面。切换配置不会把旧记录重新标记为新模式，需看记录自己的模式和时间。

## 本地报告

保持本模块开启，在 Safari 打开：

```text
https://one.google.com/g1-egern-report
```

JSON导出：

```text
https://one.google.com/g1-egern-report?format=json
```

页面应显示“本机脚本已接管”和 `g1-acq-egern-v1.0.0`。请求在 Egern 本机直接返回，不发给 Google；若看到普通Google页面或404，则未接管成功。报告记录最近网页/原生处理模式、源和目标编号、匹配/实际替换数、最近10次响应及最多300个改写前的候选编号。

脚本没有独立HTTP上报调用，不保存完整正文、账户邮箱、付款收据、请求头或原始查询参数。模块与脚本下载仍使用远程地址。

## Ultra候选目标

| 源编号 | 一折模式首选 / 备用 | 试用模式首选 / 备用 |
| --- | --- | --- |
| `g1.ios.20tb.m.v2`（网页） | `g1.20tb.3months_ip_90p.acq` / `g1.20tb.3months_ip_75p.acq` | `g1.20tb.1month_eft.acq` / `g1.20tb.3months_ip_90p.acq` |
| `g1.ios.30tb.ai.pro.m`（网页和受限原生路径） | `g1.ai.ultra.3months_ip_90p.acq` / `g1.ai.ultra.3months_ip_75p.acq` | `g1.ai.ultra.1month_eft.acq` / `g1.ai.ultra.3months_ip_90p.acq` |

各档根据本次原始响应的完整候选字符串选择：首选存在则优先首选；首选缺失且同档备用存在才使用备用；都未出现仍尝试首选。`basis=default-not-observed` 表示未在这次采集中观察到目标。这不是 App Store 商品或优惠资格校验。

额外的 `PRO_2TB=true` 会把网页 `g1.ios.2tb.` 前缀映射到 `g1.2tb.ai.12months_ip_90p`，可能覆盖原月付或年付来源。目标不能据名称认定为一次性年付或5TB权益，因此默认关闭。原生2TB和原生20TB不改写。

## 原生30TB范围

仅处理 `subscriptionsmobile-pa.googleapis.com/.../GetDynamicStorefrontInfo` POST响应。只在下列已观察路径匹配完整30TB源编号：

```text
1.11.1.11.1.18.1.2.20.1.11.1.11.1.11.1.13.1.11.1.12.1.3.4.9.4.1.2.2.1
```

数字路径来自此前手机响应，但没有 `.proto` 确认字段的业务含义。脚本重算修改字段及祖先的长度、未压缩gRPC帧长度；其他路径、未知编码、压缩帧、解析失败或超限时保留原响应。

`rewritten` 只表示已构造本地修改响应。`candidate_found` 表示只检查或关闭原生处理；`path_not_matched` 表示源编号出现在其他路径，不会自动扩大改写。通知未显示时可在 Egern 设置日志中查看 `[g1-egern]`。

UDP/443拒绝规则仅限两个MITM主机，促使支持回退的连接使用TCP。若未收到对应HTTP请求，需核对证书、当前节点/策略组的QUIC设置与模块启用状态。

## 验证范围

已通过39项Node离线检查及8个本机JavaScriptCore场景检查；Egern API桥接使用测试替身，网页映射与固定上游版本做过对照。未验证手机上的新促销价格、老会员优惠资格、付款和Google实际权益。

旧实验4曾调起2949.99里拉报价，该结果属于旧SKU `g1.ios.30tb.m`，不代表本模块促销目标也可用。是否替换原订阅、是否退款、会不会并行扣费均未验证；本模块不修改Apple收据或订阅后台。先核对App Store商品名称、周期、首次及续费金额。

模块和内部脚本使用固定提交，避免旧缓存。脚本固定提交 `9d2933db565e8c4890feb850ee4ae095a9286ff5`。
