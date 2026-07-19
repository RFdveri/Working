export interface AmoContact {
  id: number;
  name: string;
  phones: string[];
  emails: string[];
}

export interface AmoDeal {
  id: number;
  name: string;
  pipelineId: number;
  statusId: number;
  price?: number;
  contactId?: number;
}

export interface AmoNote {
  dealId: number;
  text: string;
  createdAt: string;
}

export interface AmoTask {
  id?: number;
  dealId: number;
  text: string;
  completeTill: string;
  taskTypeId?: number;
}

export interface AmoDigitalPipelineEvent {
  dealId: number;
  channel: string;
  direction: "inbound" | "outbound";
  text: string;
  attachments?: string[];
  receivedAt: string;
}

export interface AmoOAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}
