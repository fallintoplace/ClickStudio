export interface Principal {
    id: string;
    role: 'owner' | 'viewer';
}

export interface AuditEvent {
    id: string;
    at: string;
    owner: string;
    action: string;
    resourceId: string;
    outcome: 'allowed' | 'denied' | 'failed';
    ruleId?: string;
}
