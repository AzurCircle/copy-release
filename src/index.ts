import { debug, error, getInput } from '@actions/core'
import { context, getOctokit } from '@actions/github'

const token = getInput('token')
const destRepo = getInput('destination-repository')
const destToken = getInput('destination-token') || token
const shouldMigrateTauriManifest = getInput('migrate-tauri-manifest') === 'true'

const [destRepoOwner, destRepoName] = destRepo.split('/')
if (!destRepoOwner || !destRepoName) {
	error('Invalid destination repository')
}

const srcOctokit = getOctokit(token)
const destOctokit = getOctokit(destToken)

const srcRelease = await srcOctokit.rest.repos.getLatestRelease({
	owner: context.repo.owner,
	repo: context.repo.repo,
})

const srcAssets = srcRelease.data.assets.map(async (asset) => {
	// https://github.com/octokit/rest.js/issues/12
	const requestOptions = srcOctokit.request.endpoint(
		'GET /repos/:owner/:repo/releases/assets/:asset_id',
		{
			owner: context.repo.owner,
			repo: context.repo.repo,
			asset_id: asset.id,
		}
	)
	const response = await fetch(requestOptions.url, {
		headers: { Authorization: `token ${token}`, Accept: 'application/octet-stream' },
	})
	if (shouldMigrateTauriManifest) {
		if (asset.name === 'latest.json') {
			return migrateTauriManifest(await response.json())
		}
	}
	return await response.arrayBuffer()
})
const awaitedSrcAssets = await Promise.all(srcAssets)

const existingRelease = await getExistingRelease()
if (existingRelease) {
	await destOctokit.rest.repos.deleteRelease({
		owner: destRepoOwner,
		repo: destRepoName,
		release_id: existingRelease.data.id,
	})
}
const destRelease = await destOctokit.rest.repos.createRelease({
	owner: destRepoOwner,
	repo: destRepoName,
	tag_name: srcRelease.data.tag_name,
	name: srcRelease.data.name || undefined,
	body: srcRelease.data.body || undefined,
})

for (const [index, asset] of srcRelease.data.assets.entries()) {
	destOctokit.rest.repos.uploadReleaseAsset({
		owner: destRepoOwner,
		repo: destRepoName,
		release_id: destRelease.data.id,
		name: asset.name,
		//@ts-ignore
		data: awaitedSrcAssets[index],
		headers: { 'content-type': asset.content_type },
	})
}

async function getExistingRelease() {
	try {
		return await destOctokit.rest.repos.getReleaseByTag({
			owner: destRepoOwner,
			repo: destRepoName,
			tag: srcRelease.data.tag_name,
		})
	} catch (error) {}
}

function migrateTauriManifest(manifest: { platforms: { [key: string]: { url: string } } }) {
	for (const [platform, info] of Object.entries(manifest.platforms)) {
		manifest.platforms[platform].url = info.url.replace(
			`${context.repo.owner}/${context.repo.repo}`,
			destRepo
		)
	}
	return manifest
}
