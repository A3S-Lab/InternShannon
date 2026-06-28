export type CoreAgentSkill = {
  name: string;
  description: string;
};

export const PROGRESSIVE_API_SKILL_NAME = "capabilities";

export const CORE_AGENT_SKILLS: CoreAgentSkill[] = [
  {
    name: PROGRESSIVE_API_SKILL_NAME,
    description:
      "Discover and use InternShannon local APIs: list modules, search operations, describe schemas, then execute authorized operations.",
  },
  {
    name: "a3s-code-agent-framework",
    description: "Build InternShannon agent assets with the a3s-code framework and @a3s-lab/code SDK.",
  },
  {
    name: "mermaid",
    description:
      "Generate diagrams using Mermaid syntax, including flowcharts, sequence diagrams, ER diagrams, and class diagrams.",
  },
  {
    name: "vis-chart",
    description: "Generate interactive charts using vis-chart markdown syntax.",
  },
];

export const CORE_AGENT_SKILL_NAMES = CORE_AGENT_SKILLS.map((skill) => skill.name);
