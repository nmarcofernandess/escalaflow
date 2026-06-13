export interface ImportedText {
  text: string
  metadata: {
    fileName: string
    charCount: number
    format: 'text' | 'pdf'
    pageCount?: number
    author?: string
  }
}

export interface UnifiedMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp?: number
}

export interface UnifiedConversation {
  id: string
  title: string
  messages: UnifiedMessage[]
  source: 'chatgpt' | 'claude'
  createdAt?: number
  updatedAt?: number
}

export interface ImportedConversations {
  conversations: UnifiedConversation[]
  metadata: {
    fileName: string
    format: 'chatgpt' | 'claude'
    conversationCount: number
  }
}

export type ImportResult =
  | { type: 'text'; data: ImportedText }
  | { type: 'conversations'; data: ImportedConversations }
  | { type: 'error'; error: string }

export type DetectedFormat = 'text' | 'pdf' | 'chatgpt' | 'claude' | 'zip' | 'unknown'
