/**
 * 数学节点的「请求编辑」通道。
 * NodeView 渲染在 ProseMirror 的 DOM 里，React context 不一定能穿透，
 * 所以用模块级订阅：主组件注册 handler，节点被点击时发请求。
 */
export interface MathEditRequest {
  latex: string
  display: boolean
  /** 被编辑节点的文档位置（新插入时为 null） */
  pos: number | null
}

type Handler = (req: MathEditRequest) => void

let handler: Handler | null = null

export function setMathEditHandler(fn: Handler | null): void {
  handler = fn
}

export function requestMathEdit(req: MathEditRequest): void {
  handler?.(req)
}
