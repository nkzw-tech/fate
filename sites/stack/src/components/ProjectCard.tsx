export type Project = Readonly<{
  description: string;
  domain: string;
  href: string;
  name: string;
  tone: 'blue' | 'pink' | 'purple';
  type: string;
}>;

export default function ProjectCard({ description, domain, href, name, tone, type }: Project) {
  return (
    <a className={`project-card tone-${tone}`} href={href}>
      <span aria-hidden="true" className="card-surface shader-tile" />
      <div className="card-content">
        <div className="card-heading">
          <h3 className={name === 'fate' ? 'fate-name' : undefined}>{name}</h3>
          <span aria-hidden="true" className="external-arrow">
            ↗
          </span>
        </div>
        <p>{description}</p>
        <div className="card-footer">
          <span>{domain}</span>
          <span className="project-type">{type}</span>
        </div>
      </div>
    </a>
  );
}
