import { debug, error, getInput } from '@actions/core'
import { context, getOctokit } from '@actions/github'
import assert from 'node:assert'

const token = getInput('token')
const destRepo = getInput('destination-repository')
const destToken = getInput('destination-token') || token

const [destRepoOwner, destRepoName] = destRepo.split('/')[0]
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
	const response = await fetch(asset.browser_download_url, {
		headers: { Authorization: `token ${token}`, Accept: 'application/octet-stream' },
	})
	debug(await response.text())
	assert(response.ok, `Failed to fetch asset ${asset.name}`)
	return Buffer.from(await response.arrayBuffer())
})
const awaitedSrcAssets = await Promise.all(srcAssets)

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
		// @ts-expect-error
		data: awaitedSrcAssets[index],
		headers: { 'content-type': asset.content_type },
	})
}

// await Promise.all(
// 	awaitedSrcAssets.map((asset) =>
// 		destOctokit.rest.repos.uploadReleaseAsset({
// 			owner: destRepoOwner,
// 			repo: destRepoName,
// 			release_id: destRelease.data.id,
// 			name: asset.data.name,
// 			data: ,
// 		})
// 	)
// )
