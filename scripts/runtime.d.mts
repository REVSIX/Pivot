export const base: string, editorHome: string, profile: string
export function executable(name: string, override?: string): string | undefined
export function nvimPath(): string | undefined
export function pythonPath(): string | undefined
export function editorEnv(): NodeJS.ProcessEnv
