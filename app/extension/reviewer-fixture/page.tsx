const fixtureGroupUrl = "https://www.facebook.com/groups/apt-hunt-reviewer-fixture";
const fixturePostUrl =
  "https://www.facebook.com/groups/apt-hunt-reviewer-fixture/posts/reviewer-listing-1";

export default function ReviewerFixturePage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950">
      <article className="mx-auto max-w-2xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <header className="mb-5 space-y-2">
          <a
            className="font-semibold text-blue-700 underline-offset-4 hover:underline"
            href={fixtureGroupUrl}
          >
            Apt Hunt Reviewer Housing
          </a>
          <div>
            <a
              className="text-sm text-slate-600 underline-offset-4 hover:underline"
              href={fixturePostUrl}
            >
              View listing post
            </a>
          </div>
        </header>

        <div className="space-y-4 text-base leading-7">
          <p>
            Sunny one-bedroom apartment near Duboce Park, available August 1.
            The unit has hardwood floors, bay windows, a renovated kitchen,
            and shared laundry in the building.
          </p>
          <p>
            Rent is $2,750 per month with a $2,750 deposit. Water and trash are
            included. The building is close to the N Judah, Lower Haight
            groceries, and several bike routes.
          </p>
          <p>
            No broker fee. Cats considered with an additional deposit. Message
            with your move-in date, household size, and any questions.
          </p>
        </div>
      </article>
    </main>
  );
}
