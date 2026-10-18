import { ChartColumn, Database, FlaskConical, History, SquareTerminal, Workflow, type LucideIcon } from "lucide-react";

export interface Feature {
  Icon: LucideIcon;
  title: string;
  description: string;
  /** Not built yet: shown with a "Coming soon" label. */
  soon?: boolean;
}

export interface Step {
  title: string;
  description: string;
}

export const features: Feature[] = [
  {
    Icon: Database,
    title: "Data sources",
    description:
      "Upload CSV, Excel or Parquet files, or connect PostgreSQL, MySQL, Snowflake or SQL Server. Kadence reads the schema for you.",
  },
  {
    Icon: Workflow,
    title: "Pipeline Studio",
    description:
      "Filter, sort, join and append datasets, group and summarise, and add calculated columns. Every step shows a live preview.",
  },
  {
    Icon: History,
    title: "Versions and lineage",
    description:
      "Every import is saved as a new version, so you can see where a dataset came from and how it has changed.",
  },
  {
    Icon: SquareTerminal,
    title: "Query Studio",
    description: "Write SQL against the latest version of any dataset in your workspace and see the results straight away.",
  },
  {
    Icon: ChartColumn,
    title: "Dashboards",
    description: "Build quick charts from your datasets to check distributions and spot patterns.",
  },
  {
    Icon: FlaskConical,
    title: "Machine learning",
    description: "AutoML, model training and predictions are on the roadmap. The pages are there to preview the flow.",
    soon: true,
  },
];

export const steps: Step[] = [
  {
    title: "Bring in your data",
    description: "Upload a file or connect a database. Each import is saved as a new, versioned dataset.",
  },
  {
    title: "Review and shape",
    description: "Use Pipeline Studio to filter, join, group and add columns, checking a live preview as you go.",
  },
  {
    title: "Ask with SQL",
    description: "Query the latest version of your datasets in Query Studio.",
  },
  {
    title: "Chart the results",
    description: "Turn a dataset into quick charts to see what it shows.",
  },
];
