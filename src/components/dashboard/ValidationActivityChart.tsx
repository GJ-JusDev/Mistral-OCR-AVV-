"use client";

import { Card } from "@/components/ui/Card";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

type ValidationActivityChartProps = {
  data: Array<{ date: string; count: number }>;
  title?: string;
  subtitle?: string;
};

export function ValidationActivityChart({ 
  data, 
  title = "Validation Activity",
  subtitle = "Validations performed over the last 7 days" 
}: ValidationActivityChartProps) {
  
  const hasData = data.some(d => d.count > 0);

  const chartData = {
    labels: data.map((item) => item.date),
    datasets: [
      {
        label: "Validations",
        data: data.map((item) => item.count),
        backgroundColor: "#4f46e5", // Indigo 600
        borderRadius: 4,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        backgroundColor: "rgba(9, 9, 11, 0.9)",
        titleColor: "#fff",
        bodyColor: "#fff",
        padding: 10,
        cornerRadius: 8,
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          stepSize: 1,
          color: "#71717a",
        },
        grid: {
          color: "#f4f4f5",
        }
      },
      x: {
        ticks: {
          color: "#71717a",
        },
        grid: {
          display: false,
        }
      }
    }
  };

  return (
    <Card padding="lg" className="w-full h-80 flex flex-col">
      <div>
        <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{title}</h3>
        <p className="text-xs text-zinc-500 mb-4">{subtitle}</p>
      </div>
      <div className="flex-1 w-full min-h-0 relative flex justify-center pb-4">
        {!hasData ? (
          <div className="flex h-full w-full items-center justify-center">
            <p className="text-sm text-zinc-500">No validation activity yet.</p>
          </div>
        ) : (
          <Bar data={chartData} options={options} />
        )}
      </div>
    </Card>
  );
}
