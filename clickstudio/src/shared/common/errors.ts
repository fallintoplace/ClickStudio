export interface ApiError {
    code: string;
    message: string;
    remediation?: string;
    position?: number;
}
