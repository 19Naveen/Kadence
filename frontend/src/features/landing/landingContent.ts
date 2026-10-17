export interface Feature {
  icon: string;
  title: string;
  description: string;
  accent: string;
}

export interface Step {
  number: string;
  title: string;
  description: string;
}

export const features: Feature[] = [
  {
    icon: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4",
    title: "Unified Data Ingestion",
    description:
      "Connect CSV, Parquet, PostgreSQL, Snowflake, MySQL, and more. Versioned immutable snapshots stored in MinIO with full audit trail.",
    accent: "text-blue-400",
  },
  {
    icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01",
    title: "Smart Schema Management",
    description:
      "Automatic schema inference, diff detection, and mapping rules. Resolve conflicts once — rules auto-apply on every subsequent ingestion.",
    accent: "text-violet-400",
  },
  {
    icon: "M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z",
    title: "Natural Language Query Studio",
    description:
      "Interrogate any dataset in plain English. Write SQL, explore relationships, and export results — no data warehouse required.",
    accent: "text-emerald-400",
  },
  {
    icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
    title: "EDA Dashboards",
    description:
      "Instant visual analytics: distributions, correlations, outlier detection, and custom widget layouts — built for data scientists.",
    accent: "text-amber-400",
  },
  {
    icon: "M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.675.337a4 4 0 01-2.574.345l-2.313-.463c-.574-.115-1.155.032-1.536.413l-.353.354a2 2 0 010 2.828l.353.354c.007.006.014.013.02.02",
    title: "ML Training & AutoML",
    description:
      "Train models with configurable hyperparameters or let AutoML search the space automatically. Real-time progress via Celery workers.",
    accent: "text-rose-400",
  },
  {
    icon: "M13 10V3L4 14h7v7l9-11h-7z",
    title: "Inference Sandbox",
    description:
      "Deploy champion models for on-demand prediction. Compare versions, monitor drift, and promote to production with a single click.",
    accent: "text-cyan-400",
  },
];

export const steps: Step[] = [
  {
    number: "01",
    title: "Connect Your Source",
    description:
      "Upload a file or connect a database in seconds. Kadence infers schema automatically.",
  },
  {
    number: "02",
    title: "Ingest & Version",
    description:
      "Data is transformed, validated, and written as immutable Parquet snapshots. Every version is auditable.",
  },
  {
    number: "03",
    title: "Transform & Query",
    description:
      "Clean, reshape, and interrogate your data in the Query Studio. No SQL expertise required.",
  },
  {
    number: "04",
    title: "Train & Predict",
    description:
      "Select features, launch AutoML, and get production-ready models with drift monitoring built in.",
  },
];
