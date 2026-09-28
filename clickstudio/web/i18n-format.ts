export type CopyParameters = Readonly<Record<string, string | number>>;

/** Replace named placeholders once, keeping values literal and unknown placeholders visible. */
export function formatCopy(template: string, parameters: CopyParameters): string {
    return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (placeholder: string, key: string): string => {
        const value = Object.hasOwn(parameters, key) ? parameters[key] : undefined;
        return value === undefined ? placeholder : String(value);
    });
}
