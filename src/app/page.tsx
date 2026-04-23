import { Button, Card, Chip } from "@heroui/react";

const productionStages = [
  { label: "Treatment", value: "Drafting" },
  { label: "Cast", value: "Shortlist" },
  { label: "Locations", value: "Scout" },
];

export default function Home() {
  return (
    <main className="flex flex-1 flex-col bg-background text-foreground">
      <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-6 py-10 sm:px-10 lg:py-16">
        <header className="flex flex-col gap-6 border-b border-black/10 pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-4">
            <Chip color="accent" variant="soft">
              Film Maker
            </Chip>
            <h1 className="text-4xl font-semibold tracking-normal text-pretty sm:text-6xl">
              Production workspace
            </h1>
            <p className="max-w-2xl text-base leading-7 text-black/65 sm:text-lg">
              Organize the first pass of a film, from story shape to crew,
              locations, and the next shoot day.
            </p>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Button variant="primary" fullWidth>
              New project
            </Button>
            <Button variant="outline" fullWidth>
              Import notes
            </Button>
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          <Card variant="default">
            <Card.Header>
              <Card.Title>Slate</Card.Title>
              <Card.Description>
                Current production pulse for the active film.
              </Card.Description>
            </Card.Header>
            <Card.Content className="grid gap-4 sm:grid-cols-3">
              {productionStages.map((stage) => (
                <div
                  className="rounded-md border border-black/10 bg-white/60 p-4"
                  key={stage.label}
                >
                  <p className="text-sm text-black/55">{stage.label}</p>
                  <p className="mt-2 text-xl font-semibold">{stage.value}</p>
                </div>
              ))}
            </Card.Content>
          </Card>

          <Card variant="secondary">
            <Card.Header>
              <Card.Title>Next Shoot</Card.Title>
              <Card.Description>Friday, 7:00 AM at Studio B.</Card.Description>
            </Card.Header>
            <Card.Content className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-black/60">Pages locked</span>
                <Chip color="success" variant="soft">
                  12
                </Chip>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-black/60">Open tasks</span>
                <Chip color="warning" variant="soft">
                  8
                </Chip>
              </div>
            </Card.Content>
          </Card>
        </div>
      </section>
    </main>
  );
}
