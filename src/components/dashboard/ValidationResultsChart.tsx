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

type ValidationResultsChartProps = {
  matched: number;
  needsReview: number;
  mismatched: number;
};

export function ValidationResultsChart({ matched, needsReview, mismatched }: ValidationResultsChartProps) {
  const hasData = matched > 0 || needsReview > 0 || mismatched > 0;

  const chartData = {
    labels: ["Matched", "Needs Review", "Mismatched"],
    datasets: [
      {
        data: [matched, needsReview, mismatched],
        backgroundColor: [
          "#10b981", // Emerald 500 (Matched)
          "#f59e0b", // Amber 500 (Needs Review)
          "#ef4444", // Red 500 (Mismatched)
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
        position: "bottom" as const,
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
      <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-50 mb-4">Validation Results</h3>
      <div className="flex-1 w-full min-h-0 relative flex justify-center pb-4">
        {!hasData ? (
          <div className="flex h-full w-full items-center justify-center">
            <p className="text-sm text-zinc-500">No validation data.</p>
          </div>
        ) : (
          <Doughnut data={chartData} options={options} />
        )}
      </div>
    </Card>
  );
}
