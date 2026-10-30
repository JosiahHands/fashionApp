// Jest runs the tests in src/__tests__ (one file per folder in src/). SWC strips the TypeScript;
// type checking is done by `tsc -b`.
// Coverage: `npm run test:coverage` writes ./coverage; `npm run coverage:preview` opens the HTML report.

const swc = (tsx) => [
	"@swc/jest",
	{
		jsc: {
			target: "es2022",
			parser: { syntax: "typescript", tsx },
			transform: { react: { runtime: "automatic" } },
		},
	},
];

/** @type {import('jest').Config} */
export default {
	// The worker and shared tests run in Node; react-app.test.tsx opts into jsdom with a docblock.
	testEnvironment: "node",
	testMatch: ["<rootDir>/src/__tests__/**/*.test.{ts,tsx}"],
	setupFiles: ["<rootDir>/src/__tests__/setup.ts"],
	transform: {
		"^.+\\.ts$": swc(false),
		"^.+\\.tsx$": swc(true),
	},
	// CSS Modules return their class names as-is (styles.card → "card").
	moduleNameMapper: {
		"\\.module\\.css$": "identity-obj-proxy",
	},
	collectCoverageFrom: [
		"src/**/*.{ts,tsx}",
		"!src/**/*.d.ts",
		"!src/__tests__/**",
		"!src/react-app/main.tsx",
	],
	coverageDirectory: "coverage",
	// text: summary table in the terminal. lcov: coverage/lcov-report/index.html + lcov.info for editors.
	coverageReporters: ["text", "lcov"],
};
