export class ListSessionsQuery {
    constructor(
        public readonly userId: string,
        public readonly limit?: number,
        public readonly offset?: number,
        /** Desktop 兼容字段:跨用户列举所有会话。默认 false/undefined。 */
        public readonly includeAllUsers?: boolean,
        /** 只列举「真正的对话」会话，排除资产开发/编排/devops/系统等功能内部运行时会话。 */
        public readonly conversationalOnly?: boolean,
    ) {}
}
