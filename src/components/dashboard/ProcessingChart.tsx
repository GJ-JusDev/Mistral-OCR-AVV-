"use client";

import { Card } from "@/components/ui/Card";
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Doughnut } from "react-chartjs-2";

ChartJS.register(ArcElement, Tooltip, Legend);

type ProcessingChartProps = {
  data: Array<{ date: string; processed: number }>;
  title?: string;
};

export function ProcessingChart({ data, title = "Processing Volume Distribution" }: ProcessingChartProps) {
  const chartData = {
    labels: data.map((item) => item.date),
    datasets: [
      {
        label: "Processed",
        data: data.map((item) => item.processed),
        backgroundColor: [
          "#d97706", // Amber 600
          "#059669", // Emerald 600
          "#2563eb", // Blue 600
          "#db2777", // Pink 600
          "#7c3aed", // Violet 600
          "#ea580c", // Orange 600
          "#0891b2", // Cyan 600
        ],
        borderWidth: 0,
        hoverOffset: 4,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "right" as const,
        labels: {
          color: "#71717a",
          usePointStyle: true,
          padding: 20,
        },
      },
      tooltip: {
        backgroundColor: "rgba(9, 9, 11, 0.9)",
        titleColor: "#fff",
        bodyColor: "#fff",
        padding: 10,
        cornerRadius: 8,
      },
    },
    cutout: "70%",
  };

  return (
    <Card padding="lg" className="w-full h-80 flex flex-col">
      <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-50 mb-4">{title}</h3>
      <div className="flex-1 w-full min-h-0 relative flex justify-center pb-4">
        <Doughnut data={chartData} options={options} />
      </div>
    </Card>
  );
}
