import { PageHeader } from "kadence";

export const WithActions = () => (
  <div style={{ width: 860, padding: 24 }}>
    <PageHeader
      title="Workspace settings"
      subtitle="Details for Retail analytics."
      actions={
        <>
          <button className="btn btn-secondary">Open Pipeline Studio</button>
          <button className="btn btn-primary">Add data</button>
        </>
      }
    />
  </div>
);

export const TitleAndSubtitle = () => (
  <div style={{ width: 860, padding: 24 }}>
    <PageHeader title="Dashboards" subtitle="Build charts from the latest version of a dataset. Charts reset when you leave the page." />
  </div>
);
