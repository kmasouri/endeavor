import { expect, test } from '@playwright/test';
import { fixture } from './chat-fixture';
for (const width of [1280,390]) test(`routing choices preserve failures and resolve without duplicate sends at ${width}px`,async ({page}) => {
  await page.setViewportSize({width,height:850});
  const {errors,unexpected}=await fixture(page);
  let waiting=true; let fail=true; const posts:unknown[]=[];
  const decision={id:'decision',kind:'starter',status:'waiting',selectedAgentId:null,reason:'Who should act next?',revision:1,candidates:[{id:'researcher',name:'Researcher'},{id:'reviewer',name:'Reviewer'}]};
  await page.route('**/conversations/brief/routing**',async route => {
    if(route.request().method()==='GET') return route.fulfill({json:{data:[{...decision,status:waiting?'waiting':'resolved',reason:waiting?decision.reason:'A person chose no further agent work.'}]}});
    posts.push(route.request().postDataJSON());
    if(fail) return route.fulfill({status:409,json:{error:{message:'This choice changed. Reload and try again.'}}});
    waiting=false; return route.fulfill({json:{data:{...decision,status:'resolved'}}});
  });
  await page.goto('/app/#/conversations/brief');
  const choices=page.getByRole('region',{name:'Routing decisions'});
  await expect(choices.getByRole('button',{name:'Researcher',exact:true})).toBeVisible();
  await choices.getByRole('button',{name:'No one',exact:true}).click();
  await expect(choices.getByRole('alert')).toContainText('This choice changed');
  await expect(choices.getByRole('button',{name:'No one',exact:true})).toBeEnabled();
  fail=false; await choices.getByRole('button',{name:'No one',exact:true}).click();
  await expect(choices.getByRole('button',{name:'Change agent',exact:true})).toBeVisible();
  expect(posts).toEqual([{agentId:null,revision:1},{agentId:null,revision:1}]);
  expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});
