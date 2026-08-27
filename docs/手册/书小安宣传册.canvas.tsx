import {
  BarChart,
  Card,
  CardBody,
  CardHeader,
  Divider,
  Grid,
  H2,
  H3,
  Row,
  Stack,
  Table,
  Text,
  useHostTheme,
} from "cursor/canvas";

/* ---------------------------------- data --------------------------------- */

const PAIN_POINTS: Array<{ time: string; title: string; body: string }> = [
  {
    time: "每天 20 分钟",
    title: "把同一批资料传来传去",
    body: "云盘存一份，助手里传一份，本地下一份。换个对话框，从头再传一遍。",
  },
  {
    time: "每天 25 分钟",
    title: "为了核实一句话翻遍原文",
    body: "AI 给了结论，却只能说「大概在某个文档里」。你还得自己打开文件搜关键词。",
  },
  {
    time: "每天 30 分钟",
    title: "改一个表格要绕一大圈",
    body: "下载、打开 Office、修改、保存、上传覆盖。中间走错一步，版本就分叉了。",
  },
  {
    time: "说不清多少",
    title: "自动执行完才发现改错了",
    body: "智能体动手很快，但你只能事后审查。等发现问题，改动已经发生了。",
  },
];

const HERO_STATS: Array<{ value: string; label: string }> = [
  { value: "0", label: "上传下载次数" },
  { value: "9 → 3", label: "完成一件事的步骤" },
  { value: "6 → 2", label: "改一个 Office 文件的环节" },
  { value: "3 → 1", label: "要开的应用数量" },
  { value: "100%", label: "改动前先问你" },
];

const CAPABILITIES: Array<{ name: string; headline: string; body: string }> = [
  {
    name: "问",
    headline: "基于你自己的资料回答",
    body: "把文档扔进知识库，之后所有提问都建立在你的真实材料上，而不是模型的泛泛记忆。导入一次，长期可用。",
  },
  {
    name: "找",
    headline: "答案能追回原文",
    body: "每个检索结果都带着它来自哪个文件。点一下，原文就在同一个窗口里打开，不用切出去翻。",
  },
  {
    name: "改",
    headline: "Word、Excel、PPT 就地改完存回去",
    body: "在书小安里直接打开、修改、保存。写回原文件，图表、图片、格式一样不动。全程不下载、不上传。",
  },
  {
    name: "做",
    headline: "会动手，但先问你",
    body: "读文件、搜索这类操作自动放行不打断你；要写文件、跑命令时先弹窗征求同意。速度不打折，方向盘在你手上。",
  },
];

const SCENARIOS: Array<{
  title: string;
  before: string;
  after: string;
  gain: string;
}> = [
  {
    title: "客户续费运营",
    before:
      "开云盘找资料 → 上传到助手 → 提问 → 只拿到文档名，手工核对 → 下载台账 → Office 打开 → 改 → 存 → 传回云盘",
    after: "资料入库 → 同窗口提问 → 点结果看原文 → 同窗口改台账存回原文件",
    gain: "9 步压到 3 步，三个应用并成一个",
  },
  {
    title: "文献综述",
    before: "逐篇上传 5 篇 → 提问 → 没有出处，手工在 PDF 里搜 → 加第 6 篇 → 全部重传重建 → 再提问",
    after: "6 篇一次入库 → 提问 → 点结果看原文 → 加新的只处理新的 → 再提问",
    gain: "追加资料不用重来，已有的直接复用",
  },
  {
    title: "发布事故复盘",
    before: "配平台 → 传日志 → 启动智能体 → 自动执行完事后审查 → 导出产物 → 合并回本地",
    after: "打开会话 → 提问，它直接读本地日志 → 要写文件时问你一句 → 产物直接落在本地",
    gain: "少 2 步，产物不用导出合并",
  },
];

const MATRIX_HEADERS = [
  "你关心的",
  "云端聊天助手",
  "云端文档 AI",
  "本地编程助手",
  "智能体平台",
  "书小安",
];

const MATRIX_ROWS: string[][] = [
  ["资料不用重复上传", "○", "◐", "●", "○", "●"],
  ["文件留在自己电脑上", "○", "○", "◐", "◐", "●"],
  ["答案能追回原文出处", "○", "◐", "◐", "◐", "●"],
  ["Office 就地改完存回原文件", "○", "○", "○", "○", "●"],
  ["动手之前先征求同意", "◐", "○", "●", "○", "●"],
  ["异常情况一律不放行", "◐", "○", "◐", "○", "●"],
  ["知识、文件、执行同一个窗口", "◐", "◐", "◐", "◐", "●"],
  ["装上就能用，不用部署", "●", "●", "●", "○", "●"],
  ["知识库自带图谱与健康检查", "○", "◐", "○", "◐", "●"],
];

const NAMED_HEADERS = [
  "能力",
  "ChatGPT",
  "Claude",
  "M365 Copilot",
  "Notion AI",
  "Cursor",
  "AnythingLLM",
  "Dify",
  "书小安",
];

const NAMED_ROWS: string[][] = [
  ["资料不用重复上传", "●", "◐", "◐", "◐", "●", "●", "○", "●"],
  ["直接读写本机文件", "●", "◐", "○", "○", "●", "◐", "○", "●"],
  ["动手前先征求同意", "●", "●", "○", "○", "●", "○", "○", "●"],
  ["异常情况一律不放行", "◐", "◐", "○", "○", "◐", "○", "○", "●"],
  ["混合检索加智能排序", "◐", "○", "◐", "◐", "◐", "●", "●", "●"],
  ["答案能追回原文出处", "◐", "○", "◐", "◐", "◐", "◐", "◐", "●"],
  ["Office 就地改完存回", "○", "○", "◐", "○", "○", "○", "○", "●"],
  ["知识图谱与健康检查", "○", "○", "◐", "◐", "○", "◐", "◐", "●"],
  ["标准协议接外部工具", "●", "●", "○", "○", "●", "●", "◐", "●"],
  ["文件留在自己电脑上", "◐", "◐", "○", "○", "◐", "●", "●", "●"],
  ["装上就能用，不用部署", "●", "●", "◐", "●", "●", "●", "○", "●"],
  ["知识、文件、执行同窗", "◐", "○", "◐", "◐", "◐", "○", "○", "●"],
];

const AUDIENCES: Array<{ who: string; why: string }> = [
  { who: "资料不能出本机的团队", why: "文件读写全程在本地完成，知识库和索引都落在你自己的磁盘上" },
  { who: "天天和 Office、PDF 打交道的岗位", why: "五类 Office 格式应用内改完直接存回，PDF 检索能追到原文" },
  { who: "合规、审计、事故复盘", why: "每条结论都能追回它来自哪份材料，经得起追问" },
  { who: "想用智能体又不接受黑盒的团队", why: "写文件和跑命令逐次确认，异常一律不放行" },
  { who: "已有成熟目录结构的团队", why: "工作区就是你的真实文件夹，不用为了用 AI 重新搬家" },
];

/* -------------------------------- sections -------------------------------- */

function Hero() {
  const t = useHostTheme();
  return (
    <Stack gap={16}>
      <Stack gap={2}>
        <Text size="small" tone="tertiary" style={{ letterSpacing: "0.18em" }}>
          INTERNSHANNON
        </Text>
        <div style={{ fontSize: 46, lineHeight: 1.1, fontWeight: 650, color: t.text.primary }}>
          书小安
        </div>
      </Stack>

      <div
        style={{
          borderLeft: `3px solid ${t.accent.primary}`,
          paddingLeft: 18,
          paddingTop: 4,
          paddingBottom: 4,
        }}
      >
        <div style={{ fontSize: 26, lineHeight: 1.35, fontWeight: 600, color: t.text.primary }}>
          不是又一个聊天助手
        </div>
        <div style={{ fontSize: 26, lineHeight: 1.35, fontWeight: 600, color: t.accent.primary }}>
          是装在你电脑上的知识工作台
        </div>
      </div>

      <Text tone="secondary" style={{ fontSize: 15, lineHeight: 1.75, maxWidth: 720 }}>
        资料不用再传一遍，答案能追回原文，Word 和 Excel 就地改完直接存回原文件，智能体动手之前先问你一句。
        问、找、改、做——四件事，一个窗口。
      </Text>
    </Stack>
  );
}

function PainSection() {
  const t = useHostTheme();
  return (
    <Stack gap={12}>
      <Stack gap={2}>
        <H2>你每天在浪费的四段时间</H2>
        <Text tone="secondary">这些都不是「模型不够聪明」造成的，换个更强的模型也解决不了。</Text>
      </Stack>

      <Grid columns={2} gap={12}>
        {PAIN_POINTS.map((p) => (
          <div key={p.title}>
            <div
              style={{
                border: `1px solid ${t.stroke.tertiary}`,
                borderRadius: 8,
                padding: 16,
                height: "100%",
              }}
            >
              <Stack gap={6}>
                <Text size="small" style={{ color: t.accent.primary, fontWeight: 600 }}>
                  {p.time}
                </Text>
                <Text weight="semibold">{p.title}</Text>
                <Text size="small" tone="secondary">
                  {p.body}
                </Text>
              </Stack>
            </div>
          </div>
        ))}
      </Grid>

      <div
        style={{
          background: t.fill.tertiary,
          borderRadius: 8,
          padding: "18px 22px",
        }}
      >
        <Text style={{ fontSize: 17, lineHeight: 1.6 }}>
          <Text weight="semibold" style={{ color: t.accent.primary }}>
            加起来，一天 75 分钟，一年 300 多个小时。
          </Text>
          {" "}这些时间没有产出任何东西，只是在搬运。
        </Text>
      </div>
    </Stack>
  );
}

function StatsSection() {
  const t = useHostTheme();
  return (
    <Stack gap={12}>
      <H2>用书小安之后</H2>
      <Grid columns={5} gap={10}>
        {HERO_STATS.map((s) => (
          <div key={s.label}>
            <div
              style={{
                border: `1px solid ${t.stroke.secondary}`,
                borderRadius: 8,
                padding: "18px 14px",
                textAlign: "center",
                height: "100%",
              }}
            >
              <div
                style={{
                  fontSize: 30,
                  lineHeight: 1.15,
                  fontWeight: 650,
                  color: t.accent.primary,
                  whiteSpace: "nowrap",
                }}
              >
                {s.value}
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: t.text.secondary, lineHeight: 1.4 }}>
                {s.label}
              </div>
            </div>
          </div>
        ))}
      </Grid>
    </Stack>
  );
}

function ChartSection() {
  return (
    <Stack gap={8}>
      <Stack gap={2}>
        <H3>同样一件事，要走多少步</H3>
        <Text size="small" tone="tertiary">
          纵轴为你必须亲手操作的步骤数（步）
        </Text>
      </Stack>
      <BarChart
        categories={["客户续费运营", "文献综述", "发布事故复盘"]}
        series={[
          { name: "以前", data: [9, 6, 6], tone: "danger" },
          { name: "用书小安", data: [3, 5, 4], tone: "success" },
        ]}
        height={210}
        showValues
        valueSuffix=" 步"
      />
    </Stack>
  );
}

function CapabilitySection() {
  const t = useHostTheme();
  return (
    <Stack gap={12}>
      <Stack gap={2}>
        <H2>四件事，一个窗口</H2>
        <Text tone="secondary">
          以前要在四个软件之间来回切换才能完成的链条，现在从头到尾不用离开书小安。
        </Text>
      </Stack>

      <Stack gap={0}>
        {CAPABILITIES.map((c, i) => (
          <div key={c.name}>
            {i > 0 ? <Divider /> : null}
            <Row gap={20} align="start" style={{ padding: "16px 0" }}>
              <div
                style={{
                  width: 46,
                  height: 46,
                  flexShrink: 0,
                  borderRadius: 8,
                  background: t.fill.tertiary,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 22,
                  fontWeight: 600,
                  color: t.accent.primary,
                }}
              >
                {c.name}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text weight="semibold" style={{ fontSize: 16 }}>
                  {c.headline}
                </Text>
                <Text tone="secondary" style={{ lineHeight: 1.7 }}>
                  {c.body}
                </Text>
              </div>
            </Row>
          </div>
        ))}
      </Stack>
    </Stack>
  );
}

function ScenarioSection() {
  const t = useHostTheme();
  return (
    <Stack gap={12}>
      <H2>三个场景，看得见的变化</H2>

      <Stack gap={12}>
        {SCENARIOS.map((s) => (
          <div key={s.title}>
            <Card>
              <CardHeader trailing={s.gain}>{s.title}</CardHeader>
              <CardBody>
                <Stack gap={10}>
                  <Row gap={12} align="start">
                    <Text
                      size="small"
                      tone="tertiary"
                      style={{ minWidth: 42, flexShrink: 0, paddingTop: 1 }}
                    >
                      以前
                    </Text>
                    <Text size="small" tone="secondary" style={{ lineHeight: 1.7 }}>
                      {s.before}
                    </Text>
                  </Row>
                  <Row gap={12} align="start">
                    <Text
                      size="small"
                      style={{
                        minWidth: 42,
                        flexShrink: 0,
                        paddingTop: 1,
                        color: t.accent.primary,
                        fontWeight: 600,
                      }}
                    >
                      现在
                    </Text>
                    <Text size="small" style={{ lineHeight: 1.7 }}>
                      {s.after}
                    </Text>
                  </Row>
                </Stack>
              </CardBody>
            </Card>
          </div>
        ))}
      </Stack>
    </Stack>
  );
}

function MatrixSection() {
  return (
    <Stack gap={20}>
      <Stack gap={2}>
        <H2>和市面上的方案比</H2>
        <Text size="small" tone="tertiary">
          ● 做到了 ｜ ◐ 部分做到 ｜ ○ 做不到或要靠外部拼接
        </Text>
      </Stack>

      <Stack gap={8}>
        <H3>按产品类型看</H3>
        <Table
          headers={MATRIX_HEADERS}
          rows={MATRIX_ROWS}
          columnAlign={["left", "center", "center", "center", "center", "center"]}
          striped
        />
      </Stack>

      <Stack gap={8}>
        <H3>逐个产品看</H3>
        <Table
          headers={NAMED_HEADERS}
          rows={NAMED_ROWS}
          columnAlign={[
            "left",
            "center",
            "center",
            "center",
            "center",
            "center",
            "center",
            "center",
            "center",
          ]}
          striped
        />
      </Stack>
    </Stack>
  );
}

function AudienceSection() {
  const t = useHostTheme();
  return (
    <Stack gap={12}>
      <H2>谁最该用书小安</H2>
      <Stack gap={0}>
        {AUDIENCES.map((a, i) => (
          <div key={a.who}>
            {i > 0 ? <Divider /> : null}
            <Row gap={16} align="start" style={{ padding: "12px 0" }}>
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  marginTop: 8,
                  flexShrink: 0,
                  background: t.accent.primary,
                }}
              />
              <div style={{ minWidth: 210, flexShrink: 0 }}>
                <Text weight="semibold">{a.who}</Text>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text size="small" tone="secondary" style={{ lineHeight: 1.7 }}>
                  {a.why}
                </Text>
              </div>
            </Row>
          </div>
        ))}
      </Stack>
    </Stack>
  );
}

function Closing() {
  const t = useHostTheme();
  return (
    <div
      style={{
        border: `1px solid ${t.stroke.secondary}`,
        borderRadius: 10,
        background: t.fill.tertiary,
        padding: "32px 34px",
      }}
    >
      <Stack gap={14}>
        <div style={{ fontSize: 24, lineHeight: 1.45, fontWeight: 600, color: t.text.primary }}>
          别的 AI 工具，让你问得更好。
        </div>
        <div style={{ fontSize: 24, lineHeight: 1.45, fontWeight: 600, color: t.accent.primary }}>
          书小安，让你整件事做得更快。
        </div>
        <Text tone="secondary" style={{ fontSize: 15, lineHeight: 1.8, maxWidth: 680 }}>
          把资料、检索、编辑、执行放进同一个工作台，中间那些搬来搬去的动作就不存在了。
          装上就能用，不用部署，不用搬家，你的文件还在原来的位置。
        </Text>
      </Stack>
    </div>
  );
}

/* ---------------------------------- root ---------------------------------- */

export default function ShuXiaoAnBrochure() {
  const t = useHostTheme();
  return (
    <Stack gap={40} style={{ padding: "32px 28px 48px", maxWidth: 1120 }}>
      <Hero />
      <div style={{ height: 1, background: t.stroke.tertiary }} />
      <PainSection />
      <StatsSection />
      <ChartSection />
      <div style={{ height: 1, background: t.stroke.tertiary }} />
      <CapabilitySection />
      <ScenarioSection />
      <MatrixSection />
      <AudienceSection />
      <Closing />
    </Stack>
  );
}
