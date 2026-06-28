export class CountSessionsQuery {
    constructor(
        public readonly userId: string,
        /** Desktop 兼容字段:统计全部用户的会话数。默认 false/undefined。 */
        public readonly includeAllUsers?: boolean,
        /** 只统计「真正的对话」会话，排除知识/资产/系统等功能内部运行时会话。 */
        public readonly conversationalOnly?: boolean,
    ) {}
}
