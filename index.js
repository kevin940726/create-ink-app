'use strict';
const {promisify} = require('util');
const path = require('path');
const fs = require('fs');
const makeDir = require('make-dir');
const replaceString = require('replace-string');
const slugify = require('slugify');
const execa = require('execa');
const Listr = require('listr');
const cpy = require('cpy');

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

const copyWithTemplate = async (from, to, variables) => {
	const dirname = path.dirname(to);
	await makeDir(dirname);

	const source = await readFile(from, 'utf8');
	let generatedSource = source;

	if (typeof variables === 'object') {
		generatedSource = replaceString(source, '%NAME%', variables.name);
	}

	await writeFile(to, generatedSource);
};

const useTypeScript = process.argv.includes('--typescript');
let templatePath = 'templates/js';

if (useTypeScript) {
	templatePath = 'templates/ts';
}

const fromPath = file => path.join(__dirname, templatePath, file);
const toPath = (rootPath, file) => path.join(rootPath, file);

const copyTasks = (projectDirectoryPath, variables) => {
	const commonTasks = [
		copyWithTemplate(
			fromPath('_package.json'),
			toPath(projectDirectoryPath, 'package.json'),
			variables
		),
		copyWithTemplate(
			fromPath('../_common/readme.md'),
			toPath(projectDirectoryPath, 'readme.md'),
			variables
		),
		cpy(
			[
				fromPath('../_common/.editorconfig'),
				fromPath('../_common/.gitattributes'),
				fromPath('../_common/.gitignore')
			],
			projectDirectoryPath
		)
	];

	return useTypeScript
		? [
				...commonTasks,
				cpy(fromPath('source/ui.tsx'), toPath(projectDirectoryPath, 'source')),
				copyWithTemplate(
					fromPath('source/cli.tsx'),
					toPath(projectDirectoryPath, 'source/cli.tsx'),
					variables
				),
				cpy(
					fromPath('source/test.tsx'),
					toPath(projectDirectoryPath, 'source')
				),
				cpy(fromPath('tsconfig.json'), projectDirectoryPath)
		  ]
		: [
				...commonTasks,
				copyWithTemplate(
					fromPath('cli.js'),
					toPath(projectDirectoryPath, 'cli.js'),
					variables
				),
				cpy(fromPath('ui.js'), projectDirectoryPath),
				cpy(fromPath('test.js'), projectDirectoryPath)
		  ];
};

const dependencies = useTypeScript ? [''] : ['import-jsx'];

const devDependencies = useTypeScript
	? ['@ava/typescript', '@sindresorhus/tsconfig', '@types/react', 'typescript']
	: [
			'@ava/babel',
			'@babel/preset-env',
			'@babel/preset-react',
			'@babel/register'
	  ];

module.exports = (projectDirectoryPath = process.cwd()) => {
	const pkgName = slugify(path.basename(projectDirectoryPath));
	const execaInDirectory = (file, args, options = {}) =>
		execa(file, args, {
			...options,
			cwd: projectDirectoryPath
		});

	const tasks = new Listr([
		{
			title: 'Copy files',
			task: async () => {
				const variables = {
					name: pkgName
				};

				return Promise.all(copyTasks(projectDirectoryPath, variables));
			}
		},
		{
			title: 'Install dependencies',
			task: async () => {
				await execaInDirectory('npm', [
					'install',
					'meow@9',
					'ink@3',
					'react',
					...dependencies
				]);

				return execaInDirectory('npm', [
					'install',
					'--save-dev',
					'xo@0.39.1',
					'ava',
					'ink-testing-library',
					'chalk@4',
					'eslint-config-xo-react',
					'eslint-plugin-react',
					'eslint-plugin-react-hooks',
					...devDependencies
				]);
			}
		},
		{
			title: 'Link executable',
			task: async (_, task) => {
				if (useTypeScript) {
					await execaInDirectory('npm', ['run', 'build']);
				}

				try {
					await execaInDirectory('npm', ['link']);
					// eslint-disable-next-line unicorn/prefer-optional-catch-binding
				} catch (_) {
					task.skip('npm link failed, please try running with sudo');
				}
			}
		}
	]);

	console.log();
	return tasks.run();
};
