import type { ReactNode } from 'react';

const iconPaths = {
    schema: (
        <>
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="M3 9h18" />
            <path d="M9 21V9" />
        </>
    ),
    database: (
        <>
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M3 5V19A9 3 0 0 0 21 19V5" />
            <path d="M3 12A9 3 0 0 0 21 12" />
        </>
    ),
    table: (
        <>
            <path d="M3 9h18" />
            <path d="M9 3v18" />
            <rect x="3" y="3" width="18" height="18" rx="2" />
        </>
    ),
    trash: (
        <>
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </>
    ),
    view: (
        <>
            <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
            <circle cx="12" cy="12" r="3" />
        </>
    ),
    column: (
        <>
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="M9 3v18" />
            <path d="M15 3v18" />
        </>
    ),
    projection: (
        <>
            <path d="M13 13.74a2 2 0 0 1-2 0L2.5 8.87a1 1 0 0 1 0-1.74L11 2.26a2 2 0 0 1 2 0l8.5 4.87a1 1 0 0 1 0 1.74z" />
            <path d="m20 14.285 1.5.845a1 1 0 0 1 0 1.74L13 21.74a2 2 0 0 1-2 0l-8.5-4.87a1 1 0 0 1 0-1.74l1.5-.845" />
        </>
    ),
    index: (
        <>
            <path d="M2 5h20" />
            <path d="M6 12h12" />
            <path d="M9 19h6" />
        </>
    ),
    dictionary: (
        <>
            <path d="M12 5v16" />
            <path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z" />
        </>
    ),
    reference: (
        <>
            <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
            <path d="M14 2v5a1 1 0 0 0 1 1h5" />
            <path d="M10 9H8" />
            <path d="M16 13H8" />
            <path d="M16 17H8" />
        </>
    ),
    moon: (
        <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
    ),
    sun: (
        <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2" />
            <path d="M12 20v2" />
            <path d="m4.93 4.93 1.41 1.41" />
            <path d="m17.66 17.66 1.41 1.41" />
            <path d="M2 12h2" />
            <path d="M20 12h2" />
            <path d="m6.34 17.66-1.41 1.41" />
            <path d="m19.07 4.93-1.41 1.41" />
        </>
    ),
    history: (
        <>
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M12 7v5l4 2" />
        </>
    ),
    refresh: (
        <>
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
            <path d="M8 16H3v5" />
        </>
    ),
    assistant: (
        <>
            <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" />
            <path d="M20 2v4" />
            <path d="M22 4h-4" />
            <circle cx="4" cy="20" r="2" />
        </>
    ),
    chart: (
        <>
            <path d="M3 3v16a2 2 0 0 0 2 2h16" />
            <path d="m19 9-5 5-4-4-3 3" />
        </>
    ),
    details: (
        <>
            <path d="M12 16v5" />
            <path d="M16 14.639V21" />
            <path d="M20 10.656V21" />
            <path d="m22 3-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15" />
            <path d="M4 18.463V21" />
            <path d="M8 14.656V21" />
        </>
    ),
    observability: (
        <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
    ),
    pipeline: (
        <>
            <rect width="8" height="8" x="3" y="3" rx="2" />
            <path d="M7 11v4a2 2 0 0 0 2 2h4" />
            <rect width="8" height="8" x="13" y="13" rx="2" />
        </>
    ),
    parser: (
        <>
            <path d="m18 16 4-4-4-4" />
            <path d="m6 8-4 4 4 4" />
            <path d="m14.5 4-5 16" />
        </>
    ),
    documents: (
        <>
            <path d="M15 2h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8" />
            <path d="M16.706 2.706A2.4 2.4 0 0 0 15 2v5a1 1 0 0 0 1 1h5a2.4 2.4 0 0 0-.706-1.706z" />
            <path d="M5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 1.732-1" />
        </>
    ),
    examples: (
        <>
            <path d="M12 5v16" />
            <path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z" />
        </>
    ),
    search: (
        <>
            <path d="m21 21-4.34-4.34" />
            <circle cx="11" cy="11" r="8" />
        </>
    ),
    settings: (
        <>
            <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
            <circle cx="12" cy="12" r="3" />
        </>
    ),
    close: (
        <>
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
        </>
    ),
    check: <path d="M20 6 9 17l-5-5" />,
    more: (
        <>
            <circle cx="12" cy="12" r="1" />
            <circle cx="19" cy="12" r="1" />
            <circle cx="5" cy="12" r="1" />
        </>
    ),
    play: (
        <path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />
    ),
    stop: <rect width="18" height="18" x="3" y="3" rx="2" />,
    chevron: <path d="m6 9 6 6 6-6" />,
    firstPage: (
        <>
            <path d="M3 19V5" />
            <path d="m13 6-6 6 6 6" />
            <path d="M7 12h14" />
        </>
    ),
    previousPage: (
        <>
            <path d="m12 19-7-7 7-7" />
            <path d="M19 12H5" />
        </>
    ),
    nextPage: (
        <>
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
        </>
    ),
    lastPage: (
        <>
            <path d="M17 12H3" />
            <path d="m11 18 6-6-6-6" />
            <path d="M21 5v14" />
        </>
    ),
    newWindow: (
        <>
            <path d="M15 3h6v6" />
            <path d="M10 14 21 3" />
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        </>
    ),
    dock: (
        <>
            <path d="M15 15H9l6-6" />
            <path d="M9 15V9" />
            <rect x="3" y="3" width="18" height="18" rx="2" />
        </>
    ),
    plus: (
        <>
            <path d="M5 12h14" />
            <path d="M12 5v14" />
        </>
    ),
    lock: (
        <>
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </>
    ),
    importFile: (
        <>
            <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
            <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
        </>
    ),
    exportFile: (
        <>
            <path d="M12 15V3m0 0 4 4m-4-4-4 4" />
            <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
        </>
    ),
    bolt: (
        <path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z" />
    ),
    copy: (
        <>
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </>
    ),
    mic: (
        <>
            <path d="M12 19v3" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <rect x="9" y="2" width="6" height="13" rx="3" />
        </>
    ),
    send: (
        <>
            <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
            <path d="m21.854 2.147-10.94 10.939" />
        </>
    ),
    help: (
        <>
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <path d="M12 17h.01" />
        </>
    ),
    info: (
        <>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
        </>
    ),
    graph: (
        <>
            <path d="m10.586 5.414-5.172 5.172" />
            <path d="m18.586 13.414-5.172 5.172" />
            <path d="M6 12h12" />
            <circle cx="12" cy="20" r="2" />
            <circle cx="12" cy="4" r="2" />
            <circle cx="20" cy="12" r="2" />
            <circle cx="4" cy="12" r="2" />
        </>
    ),
    tree: (
        <>
            <path d="M8 5h13" />
            <path d="M13 12h8" />
            <path d="M13 19h8" />
            <path d="M3 10a2 2 0 0 0 2 2h3" />
            <path d="M3 5v12a2 2 0 0 0 2 2h3" />
        </>
    ),
    focus: (
        <>
            <circle cx="12" cy="12" r="3" />
            <path d="M3 7V5a2 2 0 0 1 2-2h2" />
            <path d="M17 3h2a2 2 0 0 1 2 2v2" />
            <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
            <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
        </>
    ),
    fit: (
        <>
            <path d="M8 3H5a2 2 0 0 0-2 2v3" />
            <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
            <path d="M3 16v3a2 2 0 0 0 2 2h3" />
            <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
        </>
    ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof iconPaths;

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
    return (
        <svg
            aria-hidden="true"
            className={className}
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            {iconPaths[name]}
        </svg>
    );
}
