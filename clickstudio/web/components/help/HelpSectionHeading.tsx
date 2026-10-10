export function HelpSectionHeading({
    eyebrow,
    title,
    description,
}: {
    eyebrow: string;
    title: string;
    description: string;
}) {
    return (
        <header className="workspace-help-section-heading">
            <span className="eyebrow">{eyebrow}</span>
            <h3>{title}</h3>
            <p>{description}</p>
        </header>
    );
}
